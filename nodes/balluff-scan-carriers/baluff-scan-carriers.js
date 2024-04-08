const { create: createStatusController } = require("../../lib/status-controller.js");

const findErrorRootCause = ({ error }) => {
    if (error.cause) {
        return findErrorRootCause({ error: error.cause });
    }

    return error;
};

module.exports = function (RED) {
    function create(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        let lastConnection = undefined;

        const mode = config.mode;

        const redConfigDataType = config.datatype;
        const lowerDataTypesByRedConfigDataTypes = {
            "tid-binary": "T",
            "epc-binary": "E"
        };
        const lowerDataType = lowerDataTypesByRedConfigDataTypes[redConfigDataType];

        if (lowerDataType === undefined) {
            node.error(`invalid data type: ${redConfigDataType}`);
            return;
        }

        const connectionConfigNode = RED.nodes.getNode(config.connection);
        if (connectionConfigNode === undefined) {
            node.error("missing connection");
            return;
        }

        const requestedMaxCarriersPerRequest = parseInt(config.maxcarriersperreq, 10);
        if (isNaN(requestedMaxCarriersPerRequest)) {
            node.error("invalid max carriers per request");
            return;
        }

        const maxCarriersPerRequest = 999;

        if (requestedMaxCarriersPerRequest !== maxCarriersPerRequest) {
            node.warn(`max carriers per request is fixed from ${requestedMaxCarriersPerRequest} to ${maxCarriersPerRequest} as it's currently not working`);
        }

        const pollIntervalMs = parseInt(config.pollintervalms, 10);
        if (isNaN(pollIntervalMs)) {
            node.error("invalid poll interval");
            return;
        }

        const statusController = createStatusController({
            node,
            busyText: "scanning",
            connectedText: "connected"
        });

        let closed = false;
        let lastError = undefined;
        let scanHandle = undefined;
        let busy = false;

        const updateStatusIcon = () => {
            if (lastError !== undefined) {
                statusController.error();
                return;
            }

            if (scanHandle !== undefined) {
                statusController.busy();
                return;
            }

            statusController.idle();
        };

        updateStatusIcon();

        const registration = connectionConfigNode.registerBaluffNode({
            onStateChange: ({ connecting, connection, error }) => {
                lastConnection = connection;
            },
        });

        const handleError = ({ error }) => {

            if (closed) {
                node.warn("handleError called after node closed");
                return;
            }

            const rootError = findErrorRootCause({ error });
            if (rootError !== error) {
                console.error(error);
            }

            node.error(rootError, rootError);

            lastError = error;
            updateStatusIcon();

            return;
        };

        let emittedEpcsOrTids = [];
        const shouldEmitOnlyOnce = config.emittagsonlyonce === true;
        const shouldEmitEmptyList = config.emitemptylist === true;

        const process = ({ carriers }) => {

            let newCarriers = [];

            if (shouldEmitOnlyOnce) {
                carriers.forEach((carrier) => {

                    let epcOrTid = (redConfigDataType === "tid-binary" ? carrier.tid : carrier.epc).toString("hex");
    
                    if (emittedEpcsOrTids.includes(epcOrTid)) {
                        return;
                    }
    
                    emittedEpcsOrTids = [
                        ...emittedEpcsOrTids,
                        epcOrTid
                    ];
    
                    newCarriers = [
                        ...newCarriers,
                        carrier
                    ];
                });
            } else {
                newCarriers = carriers;
            }

            if (newCarriers.length > 0 || shouldEmitEmptyList) {
                node.send({
                    payload: {
                        carriers
                    }
                });
            }
        };

        const start = () => {
            if (busy) {
                const error = Error("scan already started");
                node.error(error, error);
                return;
            }

            busy = true;

            if (!lastConnection) {
                handleError({ error: Error("not connected") });
                return;
            }

            emittedEpcsOrTids = [];

            const ourScanHandle = lastConnection.scanCarriersCumulated({
                dataType: lowerDataType,
                maxCarriersPerRequest,
                requestIntervalMs: pollIntervalMs,

                onScan: ({ carriers }) => {
                    if (ourScanHandle !== scanHandle) {
                        node.warn("outdated scan callback");
                        return;
                    }

                    if (closed) {
                        node.warn("scan callback called after node closed");
                        return;
                    }

                    process({ carriers });
                },

                onError: (error) => {
                    if (ourScanHandle !== scanHandle) {
                        node.warn("outdated scan error callback");
                        return;
                    }

                    if (closed) {
                        node.warn("scan error callback called after node closed");
                        return;
                    }

                    scanHandle = undefined;
                    handleError({ error });
                }
            });

            scanHandle = ourScanHandle;
            lastError = undefined;

            updateStatusIcon();
        };

        const stop = () => {
            if (!busy) {
                const error = Error("scan not started");
                node.error(error, error);
                return;
            }

            if (scanHandle !== undefined) {
                scanHandle.stop();
                scanHandle = undefined;
            }

            busy = false;
            lastError = undefined;
            emittedEpcsOrTids = [];

            updateStatusIcon();
        };

        node.on("input", (inputMessage) => {

            const shouldStart = inputMessage.payload === true;
            const shouldStop = inputMessage.payload === false;

            if (shouldStart) {
                start();
                return;
            }

            if (shouldStop) {
                stop();
                return;
            }
        });

        node.on("close", () => {
            closed = true;

            if (scanHandle !== undefined) {
                scanHandle.stop();
                scanHandle = undefined;
            }

            registration.close();
        });
    }

    RED.nodes.registerType("baluff-scan-carriers", create);
}

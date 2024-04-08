const baluffRfid = require("balluff-rfid");
const { create: createStatusController } = require("../../lib/status-controller.js");

const findErrorRootCause = ({ error }) => {
    if (error.cause) {
        return findErrorRootCause({ error: error.cause });
    }

    return error;
};

module.exports = function (RED) {
    function create (config) {
        RED.nodes.createNode(this, config);
        const node = this;

        let lastConnection = undefined;

        const mode = config.mode;

        const scanFuncNamesByMode = {
            "live": "detectCarriersLive",
            "cumulated": "detectCarriersCumulated"
        };

        const scanFuncName = scanFuncNamesByMode[mode];
        if (scanFuncName === undefined) {
            node.error(`invalid mode: ${mode}`);
            return;
        }

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

        const scanTimeMs = parseInt(config.scantime);

        const connectionConfigNode = RED.nodes.getNode(config.connection);
        if (connectionConfigNode === undefined) {
            node.error("missing connection");
            return;
        }

        const statusController = createStatusController({
            node,
            busyText: "scanning",
            connectedText: "connected"
        });

        let busy = false;
        let closed = false;
        let lastError = undefined;

        const updateStatusIcon = () => {
            if (lastError !== undefined) {
                statusController.error();
                return;
            }

            if (busy) {
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

        node.on("input", (inputMessage) => {
            if (!lastConnection) {

                const error = Error("not connected");
                node.error(error, error);

                lastError = error;
                updateStatusIcon();

                return;
            }

            const scan = lastConnection[scanFuncName];

            if (busy) {
                // busy errors are not treated as errors
                // in terms of the status icon

                const error = Error("scan already in progress");
                node.error(error, error);

                return;
            }

            busy = true;
            lastError = undefined;

            Promise.resolve().then(() => {
                return scan({ dataType: lowerDataType, scanTimeMs });
            }).then(({ error, carriers }) => {
                return { error, carriers };
            }, (error) => {
                return { error };
            }).then(({ error, carriers }) => {

                if (closed) {
                    // if node is closed, we don't care about the result
                    return;
                }

                busy = false;
                lastError = error;

                if (error !== undefined) {
                    // log error to console with full cause chain
                    console.error(`scanning failed`, error);

                    // as Node RED does not show the full cause chain
                    // we only show the root cause
                    const rootError = findErrorRootCause({ error });
                    node.error(rootError, rootError);
                } else {
                    node.send({
                        payload: {
                            carriers
                        }
                    });
                }

                updateStatusIcon();
            });

            updateStatusIcon();
        });

        node.on("close", () => {
            closed = true;
            maybeUnclaimPin();
            registration.close();
        });
    }

    RED.nodes.registerType("baluff-detect-carriers", create);
}

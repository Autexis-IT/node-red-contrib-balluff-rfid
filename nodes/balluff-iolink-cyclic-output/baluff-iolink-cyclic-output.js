const { create: createStatusController } = require("../../lib/status-controller.js");
const { performance } = require("perf_hooks");

const findErrorRootCause = ({ error }) => {
    if (error.cause) {
        return findErrorRootCause({ error: error.cause });
    }

    return error;
};

module.exports = function (RED) {
    function BaluffIoLinkCyclicOutput(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        let connecting = false;
        let lastConnection = undefined;
        let ioLinkHandle = undefined;
        let lastError = undefined;
        let closed = false;

        let nextProcessData = undefined;
        let debounceTimeoutHandle = undefined;

        let writePending = false;
        let lastWriteAt = undefined;
        let updateStatusIconTimeoutHandle = undefined;
        let notConnectedMessageShown = false;

        const busyLedMinDurationMs = 300;

        const statusController = createStatusController({
            node,
            busyText: "writing",
            connectedText: "connected"
        });

        const updateStatusIcon = () => {
            if (connecting) {
                statusController.connecting();
                return;
            }

            if (lastConnection === undefined) {
                statusController.disconnected();
                return;
            }

            if (lastError !== undefined) {
                statusController.error();
                return;
            }

            if (writePending) {
                statusController.busy();
                return;
            }

            const now = performance.now();
            const timeSinceLastWrite = lastWriteAt === undefined ? undefined : now - lastWriteAt;
            const remainingTriggerStatusTime = timeSinceLastWrite === undefined ? 0 : busyLedMinDurationMs - timeSinceLastWrite;

            if (remainingTriggerStatusTime > 0) {
                statusController.busy();

                updateStatusIconTimeoutHandle = setTimeout(() => {
                    updateStatusIcon();
                }, remainingTriggerStatusTime + 5);

                return;
            }

            statusController.connected();
        };

        updateStatusIcon();

        const debounceTimeMs = parseInt(config.debounce);
        if (isNaN(debounceTimeMs)) {
            node.error("invalid debounce time");
            return;
        }

        const connectionConfigNode = RED.nodes.getNode(config.connection);
        if (connectionConfigNode === undefined) {
            node.error("missing connection");
            return;
        }

        const maybeReleaseIoLinkHandle = () => {
            ioLinkHandle?.release();
            ioLinkHandle = undefined;
            nextProcessData = undefined;
        };

        const setup = ({ connection }) => {
            ioLinkHandle = connection.claimIoLink({
                cycleTimeBase: 0,
                cycleTime: 0,
                safeState: 0,
                validationMode: 0,
                vendorId: connectionConfigNode.ioLinkConfig.vendorId,
                deviceId: connectionConfigNode.ioLinkConfig.deviceId,
                outputLength: connectionConfigNode.ioLinkConfig.outputLength,
                inputLength: connectionConfigNode.ioLinkConfig.inputLength,
            });
        };

        const registration = connectionConfigNode.registerBaluffNode({

            onStateChange: ({ connecting: newConnecting, connection, error }) => {

                if (closed) {
                    node.warn("state change event after node close");
                    return;
                }

                const changed = connection !== lastConnection;
                lastConnection = connection;
                connecting = newConnecting;

                if (changed) {
                    lastError = undefined;
                    lastWriteAt = undefined;

                    maybeReleaseIoLinkHandle();
                    if (connection !== undefined) {
                        setup({ connection });
                    }
                }

                updateStatusIcon();
            },
        });

        const maybeWriteNextProcessData = () => {
            if (closed) {
                return;
            }
            
            if (writePending) {
                return;
            }

            if (ioLinkHandle === undefined) {
                return;
            }

            if (nextProcessData === undefined) {
                return;
            }

            if (debounceTimeoutHandle !== undefined) {
                return;
            }

            writePending = true;
            lastWriteAt = performance.now();

            lastError = undefined;
            const dataToWrite = nextProcessData;

            // make sure synchronous errors are also caught
            Promise.resolve().then(() => {
                return ioLinkHandle.writeCyclicProcessData({
                    offset: 0,
                    data: dataToWrite
                });
            }).then(({ error }) => {
                return {
                    error
                };
            }, (err) => {
                return {
                    error: err
                };
            }).then(({ error }) => {

                if (closed) {
                    return;
                }

                writePending = false;

                if (error !== undefined) {
                    lastError = error;

                    // log error to console with full cause chain
                    console.error(`writing of io link data failed`, error);

                    // as Node RED does not show the full cause chain
                    // we only show the root cause
                    const rootError = findErrorRootCause({ error });
                    node.error(rootError, rootError);
                }

                debounceTimeoutHandle = setTimeout(() => {
                    debounceTimeoutHandle = undefined;
                    maybeWriteNextProcessData();
                }, debounceTimeMs);

                updateStatusIcon();
            });

            nextProcessData = undefined;
            updateStatusIcon();
        };

        node.on("input", (inputMessage) => {

            if (ioLinkHandle === undefined) {

                if (!notConnectedMessageShown) {
                    node.error("not connected, further errors will be silenced until connected again");
                    notConnectedMessageShown = true;
                }

                return;
            }

            notConnectedMessageShown = false;

            const payload = inputMessage.payload;

            if (payload.length !== outputLength) {
                node.error("invalid payload length");
                return;
            }

            nextProcessData = payload;
            maybeWriteNextProcessData();
        });

        node.on("close", () => {
            closed = true;
            maybeReleaseIoLinkHandle();
            registration.close();
        });
    }

    RED.nodes.registerType("baluff-iolink-cyclic-output", BaluffIoLinkCyclicOutput);
}

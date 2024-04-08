const { create: createStatusController } = require("../../lib/status-controller.js");
const { performance } = require("perf_hooks");

const findErrorRootCause = ({ error }) => {
    if (error.cause) {
        return findErrorRootCause({ error: error.cause });
    }

    return error;
};

module.exports = function (RED) {
    function BalluffDigitalInput(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        const pinNumber = parseInt(config.pin, 10);
        if ([2, 4].indexOf(pinNumber) < 0) {
            node.error("invalid pin number");
            return;
        }

        const pollIntervalMs = parseInt(config.poll, 10);
        if (isNaN(pollIntervalMs)) {
            node.error("invalid poll interval");
            return;
        }

        const wiring = config.wiring;
        const eventType = config.events;

        let connecting = false;
        let lastConnection = undefined;
        let claimedPin = undefined;
        let pollHandle = undefined;
        let closed = false;

        let lastValue = undefined;

        let currentReadError = undefined;

        const statusController = createStatusController({
            node,
            busyText: "trigger",
            connectedText: "polling"
        });

        let lastTriggerAt = undefined;
        let updateStatusIconTimeoutHandle = undefined;

        const updateStatusIcon = () => {
            clearTimeout(updateStatusIconTimeoutHandle);

            if (connecting) {
                statusController.connecting();
                return;
            }

            if (lastConnection === undefined) {
                statusController.disconnected();
                return;
            }

            if (claimedPin === undefined) {
                statusController.error();
                return;
            }

            if (currentReadError !== undefined) {
                statusController.error();
                return;
            }

            const now = performance.now();
            const timeSinceLastTrigger = lastTriggerAt === undefined ? undefined : now - lastTriggerAt;
            const remainingTriggerStatusTime = timeSinceLastTrigger === undefined ? 0 : 1000 - timeSinceLastTrigger;

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

        const maybeUnclaimPin = () => {
            pollHandle?.stop();
            pollHandle = undefined;

            claimedPin?.release();
            claimedPin = undefined;

            lastValue = undefined;
            lastTriggerAt = undefined;
        };

        const trigger = ({ value }) => {
            node.send({
                payload: value
            });
            lastTriggerAt = performance.now();
        };

        const handleReadForOnChange = ({ value }) => {
            if (value === lastValue) {
                return;
            }

            trigger({ value });
            lastValue = value;
        };

        const handleReadForOnRead = ({ value }) => {
            node.send({
                payload: value
            });

            lastValue = value;
            lastTriggerAt = undefined;
        };

        const handleReadForOnRisingEdge = ({ value }) => {
            if (lastValue === false && value === true) {
                trigger({ value });
            }

            lastValue = value;
        };

        const handleReadForOnFallingEdge = ({ value }) => {
            if (lastValue === true && value === false) {
                trigger({ value });
            }

            lastValue = value;
        };

        const readHandlersByEventType = {
            "change": handleReadForOnChange,
            "read": handleReadForOnRead,
            "rising-edge": handleReadForOnRisingEdge,
            "falling-edge": handleReadForOnFallingEdge
        };

        const handleRead = readHandlersByEventType[eventType];
        if (handleRead === undefined) {
            node.error("invalid event type");
            return;
        }

        const setup = ({ connection }) => {
            claimedPin = connection.claimPinAsDigitalInput({ pinNumber });
            pollHandle = claimedPin.poll({
                onRead: ({ error, value }) => {

                    if (closed) {
                        node.warn("read event after node close");
                        return;
                    }

                    currentReadError = error;

                    if (error) {

                        // log error to console with full cause chain
                        console.error(`poll on pin ${pinNumber} failed`, error);

                        // as Node RED does not show the full cause chain
                        // we only show the root cause
                        const rootError = findErrorRootCause({ error });
                        node.error(rootError, rootError);
                    } else {
                        handleRead({ value });
                    }

                    updateStatusIcon();
                },
                pollIntervalMs
            });
            lastConnection = connection;
        };

        const connectionConfigNode = RED.nodes.getNode(config.connection);
        const registration = connectionConfigNode.registerBalluffNode({

            onStateChange: ({ connecting: newConnecting, connection, error }) => {

                if (closed) {
                    node.warn("state change event after node close");
                    return;
                }

                const changed = connection !== lastConnection;
                lastConnection = connection;

                connecting = newConnecting;

                if (changed) {
                    maybeUnclaimPin();
                    if (connection !== undefined) {
                        setup({ connection });
                    }
                }

                updateStatusIcon();
            },
        });

        node.on("close", () => {
            closed = true;
            maybeUnclaimPin();
            registration.close();
        });
    }

    RED.nodes.registerType("balluff-digital-input", BalluffDigitalInput);
}

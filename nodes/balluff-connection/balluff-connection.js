const balluffRfid = require("@autexis/balluff-rfid");

module.exports = function (RED) {

    function BalluffConnection(config) {
        RED.nodes.createNode(this, config);

        const node = this;

        node.host = config.host;

        const port = parseInt(config.port, 10);
        if (isNaN(port)) {
            node.error("invalid port");
            return;
        }

        node.port = port;

        console.log({ config });

        const ioLinkVendorId = parseInt(config.iolinkvendorid, 10);
        if (isNaN(ioLinkVendorId)) {
            node.error("invalid vendor id");
            return;
        }

        const ioLinkDeviceId = parseInt(config.iolinkdeviceid, 10);
        if (isNaN(ioLinkDeviceId)) {
            node.error("invalid device id");
            return;
        }

        const ioLinkOutputLength = parseInt(config.iolinkoutputlength, 10);
        if (isNaN(ioLinkOutputLength)) {
            node.error("invalid output length");
            return;
        }

        const ioLinkInputLength = parseInt(config.iolinkinputlength, 10);
        if (isNaN(ioLinkInputLength)) {
            node.error("invalid input length");
            return;
        }

        const ioLinkConfig = {
            vendorId: ioLinkVendorId,
            deviceId: ioLinkDeviceId,
            outputLength: ioLinkOutputLength,
            inputLength: ioLinkInputLength,
        };

        node.ioLinkConfig = ioLinkConfig;

        let conn = undefined;
        let connecting = false;
        let lastError = undefined;
        let closed = false;
        let reconnectTimeoutHandle = undefined;
        let registeredBalluffNodes = [];

        const emitStateChange = ({ connecting, connection, error }) => {
            registeredBalluffNodes.forEach((node) => {
                try {
                    node.onStateChange({ connecting, connection, error });
                } catch (ex) {
                    node.error(ex);
                }
            });
        };

        const maybeEmitStateChange = () => {
            emitStateChange({ connecting, connection: conn, error: lastError });
        };

        const maybeConnect = () => {
            if (closed) {
                return;
            }

            connecting = true;
            maybeEmitStateChange();

            const newConn = balluffRfid.connect({
                ipAddress: node.host,
                port: node.port,

                onConnect: () => {
                    connecting = false;

                    if (closed) {
                        // if node was closed during connect,
                        // make sure to close the connection
                        newConn.close();
                        return;
                    }

                    conn = newConn;
                    lastError = undefined;

                    maybeEmitStateChange();
                },

                onError: (error) => {
                    node.error(error, error);

                    connecting = false;

                    if (conn !== undefined && newConn !== conn) {
                        // assure multiple calls to onError
                        // don't result in multiple reconnects

                        node.warn("outdated connection error");

                        return;
                    }

                    conn = undefined;
                    lastError = error;

                    maybeEmitStateChange();

                    reconnectTimeoutHandle = setTimeout(() => {
                        maybeConnect();
                    }, 2000);
                }
            });
        };

        maybeConnect();

        node.registerBalluffNode = ({ onStateChange }) => {
            const balluffNode = {
                onStateChange
            };

            registeredBalluffNodes = [
                ...registeredBalluffNodes,
                balluffNode
            ];

            const close = () => {
                registeredBalluffNodes = registeredBalluffNodes.filter((n) => n !== balluffNode);
            };

            return {
                close
            };
        };

        node.on("close", () => {
            closed = true;

            if (conn !== undefined) {
                conn.close();
                conn = undefined;
            }

            if (reconnectTimeoutHandle !== undefined) {
                clearTimeout(reconnectTimeoutHandle);
                reconnectTimeoutHandle = undefined;
            }
        });
    }

    RED.nodes.registerType("balluff-connection", BalluffConnection);
}

const create = ({ node, busyText, connectedText }) => {

    const idle = () => {
        node.status({});
    };

    const connecting = () => {
        node.status({ fill: "yellow", shape: "dot", text: "connecting" });
    };

    const connected = () => {
        node.status({ fill: "green", shape: "dot", text: connectedText });
    };

    const disconnected = () => {
        node.status({ fill: "red", shape: "dot", text: "disconnected" });
    };

    const busy = () => {
        node.status({ fill: "blue", shape: "dot", text: busyText });
    };

    const error = () => {
        node.status({ fill: "red", shape: "ring", text: "error" });
    };

    return {
        idle,
        connecting,
        connected,
        disconnected,
        busy,
        error
    };
};

module.exports = {
    create
};

// === Functions ===
function graiConverter(x, c, n) {
    var hi = 2 ** 31; //1<<30; //0x80000000;
    var y = (2 ** c) - 1;
    x = x / 2 ** n;
    var low = hi - 1;
    var hi1 = ~~(x / hi);
    var hi2 = ~~(y / hi);
    var low1 = x & low;
    var low2 = y & low;
    var h = hi1 & hi2;
    var l = low1 & low2;


    return h * hi + l;
}

function getCheckDigit(companyPrefix, assetType) {
    const fullNumber = `${companyPrefix}${assetType}`;
    const array = fullNumber.split("");

    let sum = 0;

    array.slice().reverse().forEach((element, index) => {
        let multiplier;
        if (index % 2 == 0) {
            multiplier = 3;
        } else {
            multiplier = 1;
        }

        sum += parseInt(element) * multiplier;
    })

    const sumRounded = Math.ceil(sum / 10) * 10;
    return sumRounded - sum;
}

module.exports = function (RED) {
    function EpcGs1(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        const convertEpcToGrai = ({ epc }) => {
            
            const graiCodePrefix = "(8003)0";
            const companyPrefix = graiConverter(epc.readUInt32BE(1), 24, 2);
            const assetType = "00" + graiConverter(epc.readUInt32BE(4), 20, 6);
            const checkDigit = getCheckDigit(companyPrefix, assetType);
            const serialNumber = graiConverter(parseInt(epc.slice(6, 12).toString("hex"), 16), 38, 0);
        
            const graiCode = `${graiCodePrefix}${companyPrefix}${assetType}${checkDigit}${serialNumber}`;

            return graiCode;
        };

        node.on("input", (inputMessage) => {

            const carriersWithGrai = inputMessage.payload.carriers.map((carrier) => {

                const { epc, ...otherProps } = carrier;
                const grai = convertEpcToGrai({ epc });

                return {
                    grai,
                    ...otherProps
                };
            });

            node.send({
                payload: {
                    carriers: carriersWithGrai
                }
            });            
        });
    }

    RED.nodes.registerType("epc-gs1", EpcGs1);
}

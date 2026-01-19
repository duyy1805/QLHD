import axios from "axios";

async function run() {
    const ids = [
        60332
    ];

    const API_URL = "http://125.212.207.52:1422/ERP";
    const API_KEY = "ZD8GnLFq%7CiW@ty/#pepn/%60x|!n#1bkkkx%3C/{@?zRs5',|[AE%60.S:3;v+.%60Mo_HZF";

    const results = [];

    for (const id of ids) {
        const res = await axios.post(
            API_URL,
            {
                LoaiPhieu: 2,
                TrangThai: 1,
                ID_Phieu: id
            },
            {
                headers: {
                    "Content-Type": "application/json",
                    "ApiKey": API_KEY
                }
            }
        );

        results.push({
            ID_Phieu: id,
            data: res.data
        });
    }

    console.log(results);
}

run().catch(err => {
    console.error("❌ Lỗi:", err.message);
});

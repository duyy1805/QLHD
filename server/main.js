import axios from "axios";

async function run() {
    const ids = [
        73407,
        73595,
        73651,
        73759,
        73765,
        73788,
        73789,
        73800,
        73860,
        73861,
        73872,
        73873,
        73883,
        73884,
        73894,
        73905,
        73906,
        73907,
        73908,
        73909,
        73910,
        73913,
        73917
    ];

    const API_URL = "http://125.212.207.52:1422/ERP";
    const API_KEY = "ZD8GnLFq%7CiW@ty/#pepn/%60x|!n#1bkkkx%3C/{@?zRs5',|[AE%60.S:3;v+.%60Mo_HZF";

    const results = [];

    for (const id of ids) {
        const res = await axios.post(
            API_URL,
            null,
            {
                params: {
                    ID_Phieu: id,
                    LoaiPhieu: 1,
                    TrangThai: 1
                },
                headers: {
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

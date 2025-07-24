// services/hopdongService.ts
import axios from "axios";
import apiConfig from "../../../apiConfig.json";

export const fetchLookup = () => axios.get(`${apiConfig.API_BASE_URL}/HSTT/lookup`);

export const fetchHoSoThanhToan = (BoPhanId: string | null) =>
    axios.post(`${apiConfig.API_BASE_URL}/HSTT/HoSoThanhToan`, {
        BoPhanId,
    });

export const deleteHoSoThanhToan = (id: number) =>
    axios.delete(`${apiConfig.API_BASE_URL}/HSTT/xoa-hosothanhtoan/${id}`);

export const uploadHoSoThanhToan = (data: FormData) =>
    axios.post(`${apiConfig.API_BASE_URL}/HSTT/them-hosothanhtoan`, data, {
        headers: { "Content-Type": "multipart/form-data" },
    });
export const updateHoSoThanhToan = (data: FormData) =>
    axios.put(`${apiConfig.API_BASE_URL}/HSTT/sua-hosothanhtoan`, data, {
        headers: { "Content-Type": "multipart/form-data" },
    });

export const fetchVanBanByHoSo = async (HoSoId: number | null) => {
    return await axios.get(`${apiConfig.API_BASE_URL}/HSTT/vanban`, {
        params: {
            HoSoId: HoSoId,
        },
    });
};

export const uploadVanBan = (formData: FormData) =>
    axios.post(`${apiConfig.API_BASE_URL}/HSTT/them-vanban`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
    });

export const updateVanBan = (data: FormData) =>
    axios.put(`${apiConfig.API_BASE_URL}/HSTT/sua-vanban`, data, {
        headers: { "Content-Type": "multipart/form-data" },
    });

export const deleteVanBan = (id: number) =>
    axios.delete(`${apiConfig.API_BASE_URL}/HSTT/xoa-vanban/${id}`);
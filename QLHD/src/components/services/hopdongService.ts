// services/hopdongService.ts
import axios from "axios";
import apiConfig from "../../../apiConfig.json";

export const fetchLookup = () => axios.get(`${apiConfig.API_BASE_URL}/QLHD/lookup`);

export const fetchHopDong = (TenCoQuan: string | null) =>
    axios.post(`${apiConfig.API_BASE_URL}/QLHD/hopdong`, {
        TenCoQuan,
        SoVanBanNoiBo: null,
    });

export const deleteHopDong = (id: number) =>
    axios.delete(`${apiConfig.API_BASE_URL}/QLHD/xoa-hopdong/${id}`);

export const uploadHopDong = (data: FormData) =>
    axios.post(`${apiConfig.API_BASE_URL}/QLHD/them-hopdong`, data, {
        headers: { "Content-Type": "multipart/form-data" },
    });

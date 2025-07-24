// services/vanbandiService.ts
import axios from "axios";
import apiConfig from "../../../apiConfig.json";

export const fetchLookupVanBanDi = () =>
    axios.get(`${apiConfig.API_BASE_URL}/vanbandi/lookup-vanbandi`);

export const fetchVanBanDi = (idCQ: string | null) =>
    axios.post(`${apiConfig.API_BASE_URL}/vanbandi/vanbandi`, {
        CoQuanId: idCQ,
        SoVanBan: null,
    });

export const deleteVanBanDi = (id: number) =>
    axios.delete(`${apiConfig.API_BASE_URL}/vanbandi/xoa-vanbandi/${id}`);

export const uploadVanBanDi = (data: FormData) =>
    axios.post(`${apiConfig.API_BASE_URL}/vanbandi/them-vanbandi`, data, {
        headers: { "Content-Type": "multipart/form-data" },
    });

export const updateVanBanDi = (data: FormData) =>
    axios.put(`${apiConfig.API_BASE_URL}/vanbandi/sua-vanbandi`, data, {
        headers: { "Content-Type": "multipart/form-data" },
    });

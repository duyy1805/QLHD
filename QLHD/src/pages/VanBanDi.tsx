import React, { useState, useEffect } from "react";
import VanBanDiTable from "@/components/vanbandi/VanBanDiTable";
import {
  fetchLookupVanBanDi,
  fetchVanBanDi,
  deleteVanBanDi as apiDeleteVanBanDi,
  uploadVanBanDi,
  updateVanBanDi,
} from "../components/services/vanbandiService";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import apiConfig from "../../apiConfig.json";
import { toast } from "sonner";
import { Combobox } from "@/components/hopdong/ComboBox";

interface CoQuan {
  Id: number;
  TenCoQuan: string;
}

export interface VanBanDi {
  Id: number;
  SoVanBan: string;
  TenVanBan: string;
  NgayVanBan: string;
  NguoiKy: string;
  NoiNhan: string;
  SoLuongBan: number;
  NgayChuyen: string;
  GhiChu: string;
  LoaiVanBan: string;
  TenCoQuan: string;
  FilePath: string | null;
  CreatedAt: string;
}

export default function VanBanDi() {
  const [open, setOpen] = useState(false);
  const [pdfDialogOpen, setPdfDialogOpen] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [vanBans, setVanBans] = useState<VanBanDi[]>([]);
  const [editingVanBan, setEditingVanBan] = useState<VanBanDi | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [lookup, setLookup] = useState<{
    loaiVanBan: { Id: number; TenLoai: string }[];
    coQuan: { Id: number; TenCoQuan: string }[];
    nguoiKy: { Id: number; HoTen: string; ChucVu: string }[];
  }>({ loaiVanBan: [], coQuan: [], nguoiKy: [] });

  const [form, setForm] = useState({
    LoaiVanBanId: "",
    CoQuanId: "",
    TenVanBan: "",
    NgayVanBan: "",
    NguoiKyId: "",
    NoiNhanId: "",
    SoLuongBan: "",
    NgayChuyen: "",
    GhiChu: "",
  });

  const role = localStorage.getItem("role");
  const coQuanId = localStorage.getItem("coQuanId");
  const userId = localStorage.getItem("userId");

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleCustomChange = (name: string, value: string) => {
    setForm({ ...form, [name]: value });
  };

  const handleEdit = (vb: VanBanDi) => {
    const loai =
      lookup.loaiVanBan
        .find((l) => l.TenLoai === vb.LoaiVanBan)
        ?.Id.toString() || "";
    const coQuan =
      lookup.coQuan.find((cq) => cq.TenCoQuan === vb.NoiNhan)?.Id.toString() ||
      "";
    const nguoiKy =
      lookup.nguoiKy.find((cq) => cq.HoTen === vb.NguoiKy)?.Id.toString() || "";
    setForm({
      LoaiVanBanId: loai,
      CoQuanId: coQuan,
      TenVanBan: vb.TenVanBan,
      NgayVanBan: vb.NgayVanBan ? vb.NgayVanBan.slice(0, 10) : "",
      NguoiKyId: nguoiKy,
      NoiNhanId: coQuan,
      SoLuongBan: vb.SoLuongBan.toString(),
      NgayChuyen: vb.NgayChuyen ? vb.NgayChuyen.slice(0, 10) : "",
      GhiChu: vb.GhiChu,
    });
    setEditingVanBan(vb);
    setOpen(true);
  };

  const handleSubmit = async () => {
    if (!form.LoaiVanBanId || (!form.CoQuanId && role === "admin")) {
      toast.error("Vui lòng chọn loại văn bản và cơ quan.");
      return;
    }

    const formData = new FormData();
    for (const key in form) {
      const value = form[key as keyof typeof form];
      formData.append(key, value);
    }

    formData.append("CreatedBy", userId || "");
    if (role !== "admin") {
      formData.set("CoQuanId", coQuanId || "");
    }
    if (editingVanBan) {
      formData.append("Id", editingVanBan.Id.toString());
    }
    if (file) {
      formData.append("file", file);
    }

    try {
      if (editingVanBan) {
        await updateVanBanDi(formData);
        toast.success("Đã cập nhật văn bản đi");
      } else {
        await uploadVanBanDi(formData);
        toast.success("Đã thêm văn bản đi");
      }

      setOpen(false);
      resetForm();
      loadVanBanDi();
    } catch (err) {
      console.error(err);
      toast.error("Lỗi khi lưu văn bản đi");
    }
  };

  const resetForm = () => {
    setForm({
      LoaiVanBanId: "",
      CoQuanId: "",
      TenVanBan: "",
      NgayVanBan: "",
      NguoiKyId: "",
      NoiNhanId: "",
      SoLuongBan: "",
      NgayChuyen: "",
      GhiChu: "",
    });
    setEditingVanBan(null);
    setFile(null);
  };

  const handleDelete = async (id: number) => {
    try {
      await apiDeleteVanBanDi(id);
      toast.success("Đã xóa văn bản đi");
      setVanBans((prev) => prev.filter((vb) => vb.Id !== id));
    } catch (err) {
      toast.error("Lỗi khi xóa");
      console.error(err);
    }
  };

  const handleRowClick = (filePath: string | null) => {
    if (filePath) {
      const relativePath = filePath.replace(
        "C:/DocumentsUpload/VanBanDi/Upload",
        "/uploads_vbd"
      );
      const publicUrl = `${apiConfig.API_BASE_URL}${relativePath}`;
      setPdfUrl(publicUrl);
      setPdfDialogOpen(true);
    }
  };

  const loadVanBanDi = async () => {
    try {
      const res = await fetchLookupVanBanDi();
      setLookup(res.data);
      let tenCQ: string | null = null;
      if (role !== "admin") {
        tenCQ = res.data.coQuan.find(
          (cq: CoQuan) => String(cq.Id) === coQuanId
        )?.TenCoQuan;
      }
      const vanBanRes = await fetchVanBanDi(tenCQ);
      setVanBans(vanBanRes.data);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    loadVanBanDi();
  }, []);

  return (
    <div className="p-6">
      <div className="mb-4 flex justify-between items-center bg-gray-100 border rounded p-4">
        <h2 className="text-xl font-bold">Quản lý Văn bản đi</h2>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>+ Thêm văn bản</Button>
          </DialogTrigger>

          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                {editingVanBan ? "Sửa" : "Thêm"} văn bản đi
              </DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
              <div>
                <label className="block text-sm font-medium mb-1">
                  Loại văn bản
                </label>
                <Combobox
                  value={form.LoaiVanBanId}
                  onChange={(val) => handleCustomChange("LoaiVanBanId", val)}
                  placeholder="-- Chọn loại văn bản --"
                  options={lookup.loaiVanBan.map((x) => ({
                    label: x.TenLoai,
                    value: x.Id.toString(),
                  }))}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  Loại văn bản
                </label>
                {role === "admin" ? (
                  <Combobox
                    value={form.CoQuanId}
                    onChange={(val) => handleCustomChange("CoQuanId", val)}
                    placeholder="-- Chọn cơ quan --"
                    options={lookup.coQuan.map((x) => ({
                      label: x.TenCoQuan,
                      value: x.Id.toString(),
                    }))}
                  />
                ) : (
                  <p className="text-sm text-gray-600 px-3 py-2 bg-gray-100 rounded-md">
                    {lookup.coQuan.find((cq) => String(cq.Id) === coQuanId)
                      ?.TenCoQuan ?? "Không rõ"}
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  Tên văn bản
                </label>
                <Input
                  placeholder="Tên văn bản"
                  name="TenVanBan"
                  value={form.TenVanBan}
                  onChange={handleChange}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  Ngày văn bản
                </label>
                <Input
                  type="date"
                  placeholder="Ngày văn bản"
                  name="NgayVanBan"
                  value={form.NgayVanBan}
                  onChange={handleChange}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  Người ký
                </label>
                <Combobox
                  value={form.NguoiKyId}
                  onChange={(val) => handleCustomChange("NguoiKyId", val)}
                  placeholder="-- Chọn người ký --"
                  options={lookup.nguoiKy.map((x) => ({
                    label: x.HoTen + " - " + x.ChucVu,
                    value: x.Id.toString(),
                  }))}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  Nơi nhận
                </label>
                {role === "admin" ? (
                  <Combobox
                    value={form.NoiNhanId}
                    onChange={(val) => handleCustomChange("NoiNhanId", val)}
                    placeholder="-- Chọn nơi nhận --"
                    options={lookup.coQuan.map((x) => ({
                      label: x.TenCoQuan,
                      value: x.Id.toString(),
                    }))}
                  />
                ) : (
                  <p className="text-sm text-gray-600 px-3 py-2 bg-gray-100 rounded-md">
                    {lookup.coQuan.find((cq) => String(cq.Id) === coQuanId)
                      ?.TenCoQuan ?? "Không rõ"}
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  Số lượng
                </label>
                <Input
                  type="number"
                  placeholder="Số lượng bản"
                  name="SoLuongBan"
                  value={form.SoLuongBan}
                  onChange={handleChange}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  Ngày chuyển
                </label>
                <Input
                  type="date"
                  placeholder="Ngày chuyển"
                  name="NgayChuyen"
                  value={form.NgayChuyen}
                  onChange={handleChange}
                />
              </div>
              <Textarea
                placeholder="Ghi chú"
                name="GhiChu"
                value={form.GhiChu}
                onChange={handleChange}
                className="md:col-span-2"
              />
              <div>
                <label className="block text-sm font-medium mb-1">
                  Chọn file
                </label>
                <Input
                  type="file"
                  accept="application/pdf"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                  className="md:col-span-2"
                />
                {file && (
                  <p className="text-sm text-green-600 mt-1">
                    Đã chọn: {file.name}
                  </p>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button onClick={handleSubmit}>Lưu</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={pdfDialogOpen} onOpenChange={setPdfDialogOpen}>
          <DialogContent className="sm:max-w-4xl h-[95vh]">
            <DialogHeader>
              <DialogTitle>Xem văn bản PDF</DialogTitle>
            </DialogHeader>
            {pdfUrl ? (
              <iframe
                src={pdfUrl}
                title="Xem PDF"
                className="w-full h-[85vh] border"
              ></iframe>
            ) : (
              <p className="text-red-500">Không tìm thấy file PDF.</p>
            )}
          </DialogContent>
        </Dialog>
      </div>

      <VanBanDiTable
        data={vanBans}
        onRowClick={handleRowClick}
        onEdit={handleEdit}
        onDelete={handleDelete}
        role={role}
      />
    </div>
  );
}

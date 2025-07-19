import React, { useState, useEffect } from "react";
import HopDongTable from "@/components/hopdong/HopDongTable";
import {
  fetchLookup,
  fetchHopDong,
  deleteHopDong as apiDeleteHopDong,
  uploadHopDong,
  updateHopDong,
} from "../components/services/hopdongService";
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

export interface HopDong {
  Id: number;
  SoVanBanNoiBo: string;
  NgayDangKy: string;
  LoaiVanBan: string;
  TenCoQuan: string;
  TenVietTat: string;
  TenHeThong: string;
  TenDoiTac: string;
  TrichYeu: string;
  TinhTrang: string;
  GhiChu: string;
  FilePath: string | null;
  CreatedAt: string;
  UpdatedAt: string;
}

interface CoQuan {
  Id: number;
  TenCoQuan: string;
}

export default function HopDong() {
  const [open, setOpen] = useState(false);
  const [pdfDialogOpen, setPdfDialogOpen] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [form, setForm] = useState({
    LoaiVanBanId: "",
    CoQuanId: "",
    HeThongId: "",
    DoiTacId: "",
    TrichYeu: "",
    TinhTrangId: "",
    GhiChu: "",
  });
  const [lookup, setLookup] = useState<{
    loaiVanBan: { Id: number; TenLoai: string }[];
    coQuan: CoQuan[];
    heThong: { Id: number; TenHeThong: string }[];
    doiTac: { Id: number; TenDoiTac: string }[];
    tinhTrang: { Id: number; TenTinhTrang: string }[];
  }>({
    loaiVanBan: [],
    coQuan: [],
    heThong: [],
    doiTac: [],
    tinhTrang: [],
  });

  const [file, setFile] = useState<File | null>(null);
  const [hopDongs, setHopDongs] = useState<HopDong[]>([]);
  const [editingHopDong, setEditingHopDong] = useState<HopDong | null>(null);
  const coQuanId = localStorage.getItem("coQuanId");
  const role = localStorage.getItem("role");
  const userId = localStorage.getItem("userId");
  const handleChange = (
    e: React.ChangeEvent<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >
  ) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleEditHopDong = (hopDong: HopDong) => {
    setForm({
      LoaiVanBanId:
        lookup.loaiVanBan
          .find((x) => x.TenLoai === hopDong.LoaiVanBan)
          ?.Id.toString() || "",
      CoQuanId:
        lookup.coQuan
          .find((x) => x.TenCoQuan === hopDong.TenCoQuan)
          ?.Id.toString() || "",
      HeThongId:
        lookup.heThong
          .find((x) => x.TenHeThong === hopDong.TenHeThong)
          ?.Id.toString() || "",
      DoiTacId:
        lookup.doiTac
          .find((x) => x.TenDoiTac === hopDong.TenDoiTac)
          ?.Id.toString() || "",
      TinhTrangId:
        lookup.tinhTrang
          .find((x) => x.TenTinhTrang === hopDong.TinhTrang)
          ?.Id.toString() || "",
      GhiChu: hopDong.GhiChu,
      TrichYeu: hopDong.TrichYeu,
    });
    setEditingHopDong(hopDong);
    setOpen(true);
  };
  const handleSubmit = async () => {
    if (!coQuanId) {
      toast.error("Không xác định được cơ quan", {
        description: "Vui lòng đăng nhập lại để hệ thống nhận diện cơ quan.",
      });
      return;
    }

    const isEdit = !!editingHopDong;

    if (
      !form.LoaiVanBanId ||
      !form.HeThongId ||
      !form.DoiTacId ||
      !form.TinhTrangId
    ) {
      toast.error("Thiếu thông tin", {
        description:
          "Vui lòng chọn đầy đủ các mục: Loại VB, Hệ thống, Đối tác, Tình trạng.",
      });
      return;
    }

    if (!file && !isEdit) {
      toast.error("Thiếu tệp PDF", {
        description: "Vui lòng chọn tệp PDF hợp đồng trước khi lưu.",
      });
      return;
    }

    try {
      const formData = new FormData();

      for (const key in form) {
        if (key === "CoQuanId" && role !== "admin") {
          formData.append("CoQuanId", coQuanId || "");
        } else {
          formData.append(key, form[key as keyof typeof form]);
        }
      }

      formData.append("CreatedBy", userId || "");
      if (isEdit) {
        formData.append("Id", editingHopDong.Id.toString());
      }

      if (file) {
        formData.append("file", file);
      }

      if (isEdit) {
        await updateHopDong(formData);
        toast.success("Đã cập nhật hợp đồng");
      } else {
        await uploadHopDong(formData);
        toast.success("Đã thêm hợp đồng mới");
      }

      setOpen(false);
      setEditingHopDong(null);
      setFile(null);
      setForm({
        LoaiVanBanId: "",
        CoQuanId: "",
        HeThongId: "",
        DoiTacId: "",
        TrichYeu: "",
        TinhTrangId: "",
        GhiChu: "",
      });

      await loadHopDongs();
    } catch (err) {
      console.error("Lỗi khi lưu hợp đồng:", err);
      toast.error("Lỗi khi lưu hợp đồng");
    }
  };

  const handleDeleteHopDong = async (id: number) => {
    try {
      await apiDeleteHopDong(id);
      toast.success("Đã xóa hợp đồng");
      // Cập nhật lại danh sách hopDongs bằng cách lọc bỏ id
      setHopDongs((prev) => prev.filter((hd) => hd.Id !== id));
    } catch (err) {
      toast.error("Lỗi khi xóa hợp đồng");
      console.error(err);
    }
  };

  const loadHopDongs = async () => {
    try {
      const lookupRes = await fetchLookup();
      setLookup(lookupRes.data);

      let tenCQ: string | null = null;
      if (role !== "admin") {
        tenCQ = lookupRes.data.coQuan.find(
          (cq: CoQuan) => String(cq.Id) === coQuanId
        )?.TenCoQuan;
      }

      const hopDongRes = await fetchHopDong(tenCQ ?? null);
      setHopDongs(hopDongRes.data);
    } catch (err) {
      console.error("Lỗi khi load dữ liệu:", err);
    }
  };

  useEffect(() => {
    loadHopDongs();
  }, []);

  const handleRowClick = (filePath: string | null) => {
    if (filePath) {
      // C:/HopDong/Upload/2025/... -> /uploads/2025/...
      const relativePath = filePath.replace("C:/HopDong/Upload", "/uploads");
      const publicUrl = `${apiConfig.API_BASE_URL}${relativePath}`;
      setPdfUrl(publicUrl);
      setPdfDialogOpen(true);
    }
  };
  const handleCustomChange = (name: string, value: string) => {
    setForm({ ...form, [name]: value });
  };

  return (
    <div className="p-6">
      <div className="mb-4 flex justify-between items-center bg-gray-100 border rounded p-4">
        <h2 className="text-xl font-bold text-gray-800">Quản lý Hợp đồng</h2>

        <Dialog
          open={open}
          onOpenChange={(isOpen) => {
            setOpen(isOpen);
            if (!isOpen) {
              setEditingHopDong(null); // reset sửa
              setFile(null); // reset file
              setForm({
                LoaiVanBanId: "",
                CoQuanId: "",
                HeThongId: "",
                DoiTacId: "",
                TrichYeu: "",
                TinhTrangId: "",
                GhiChu: "",
              });
            }
          }}
        >
          <DialogTrigger asChild>
            <Button variant="default">+ Thêm hợp đồng</Button>
          </DialogTrigger>

          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Thêm hợp đồng</DialogTitle>
            </DialogHeader>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
              {/* Loại văn bản */}
              <div>
                <label
                  htmlFor="LoaiVanBanId"
                  className="block text-sm font-medium mb-1"
                >
                  Loại văn bản
                </label>
                <Combobox
                  value={form.LoaiVanBanId}
                  onChange={(val) => handleCustomChange("LoaiVanBanId", val)}
                  placeholder="-- Chọn loại văn bản --"
                  options={lookup.loaiVanBan.map((item) => ({
                    label: item.TenLoai,
                    value: item.Id.toString(),
                  }))}
                />
              </div>

              {/* Cơ quan */}
              <div>
                <label className="block text-sm font-medium mb-1">
                  Cơ quan
                </label>

                {role === "admin" ? (
                  // ✅ Admin được chọn
                  <Combobox
                    value={form.CoQuanId}
                    onChange={(val) => handleCustomChange("CoQuanId", val)}
                    options={lookup.coQuan.map((item) => ({
                      label: item.TenCoQuan,
                      value: item.Id.toString(),
                    }))}
                    placeholder="-- Chọn cơ quan --"
                  />
                ) : (
                  // ❌ Người dùng thường chỉ xem
                  <p className="text-sm text-gray-600 px-3 py-2 bg-gray-100 rounded-md">
                    {lookup.coQuan.find(
                      (cq) => String(cq.Id) === localStorage.getItem("coQuanId")
                    )?.TenCoQuan ?? "Không rõ"}
                  </p>
                )}
              </div>

              {/* Hệ thống */}
              <div>
                <label
                  htmlFor="HeThongId"
                  className="block text-sm font-medium mb-1"
                >
                  Hệ thống
                </label>
                <Combobox
                  value={form.HeThongId}
                  onChange={(val) => handleCustomChange("HeThongId", val)}
                  options={lookup.heThong.map((item) => ({
                    label: item.TenHeThong,
                    value: item.Id.toString(),
                  }))}
                  placeholder="-- Chọn hệ thống --"
                />
              </div>

              {/* Đối tác */}
              <div>
                <label
                  htmlFor="DoiTacId"
                  className="block text-sm font-medium mb-1"
                >
                  Đối tác
                </label>
                <Combobox
                  value={form.DoiTacId}
                  onChange={(val) => handleCustomChange("DoiTacId", val)}
                  options={lookup.doiTac.map((item) => ({
                    label: item.TenDoiTac,
                    value: item.Id.toString(),
                  }))}
                  placeholder="-- Chọn đối tác --"
                />
              </div>

              {/* Tình trạng */}
              <div>
                <label
                  htmlFor="TinhTrangId"
                  className="block text-sm font-medium mb-1"
                >
                  Tình trạng
                </label>
                <Combobox
                  value={form.TinhTrangId}
                  onChange={(val) => handleCustomChange("TinhTrangId", val)}
                  options={lookup.tinhTrang.map((item) => ({
                    label: item.TenTinhTrang,
                    value: item.Id.toString(),
                  }))}
                  placeholder="-- Chọn tình trạng --"
                />
              </div>

              {/* Ghi chú */}
              <div className="md:col-span-2">
                <label
                  htmlFor="GhiChu"
                  className="block text-sm font-medium mb-1"
                >
                  Ghi chú
                </label>
                <Textarea
                  id="GhiChu"
                  name="GhiChu"
                  value={form.GhiChu}
                  onChange={handleChange}
                  className="w-full"
                  rows={2}
                />
              </div>

              {/* Trích yếu */}
              <div className="md:col-span-2">
                <label
                  htmlFor="TrichYeu"
                  className="block text-sm font-medium mb-1"
                >
                  Trích yếu
                </label>
                <Textarea
                  id="TrichYeu"
                  name="TrichYeu"
                  value={form.TrichYeu}
                  onChange={handleChange}
                  className="w-full"
                  rows={2}
                />
              </div>

              {/* File PDF */}
              <div className="md:col-span-2">
                <label
                  htmlFor="FilePath"
                  className="block text-sm font-medium mb-1"
                >
                  Tệp PDF hợp đồng
                </label>
                <Input
                  id="FilePath"
                  type="file"
                  accept="application/pdf"
                  required
                  onChange={(e) => {
                    const selected = e.target.files?.[0];
                    if (selected) setFile(selected);
                  }}
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
              <DialogTitle>Xem Hợp đồng PDF</DialogTitle>
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

      <HopDongTable
        data={hopDongs}
        onRowClick={handleRowClick}
        role={role}
        onDelete={handleDeleteHopDong}
        onEdit={handleEditHopDong} // 🔸 thêm dòng này
      />
    </div>
  );
}

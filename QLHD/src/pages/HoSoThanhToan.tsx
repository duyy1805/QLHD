import React, { useState, useEffect } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
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
import { Combobox } from "@/components/hopdong/ComboBox";
import { toast } from "sonner";
import {
  fetchLookup,
  fetchHoSoThanhToan,
  uploadHoSoThanhToan,
  updateHoSoThanhToan,
  fetchVanBanByHoSo,
  uploadVanBan,
  deleteHoSoThanhToan,
  updateVanBan,
} from "@/components/services/hosothanhtoanService";
import apiConfig from "../../apiConfig.json";

interface HoSoThanhToan {
  Id: number;
  SoHoSo: string;
  TenHoSo: string;
  GhiChu: string;
  TenCoQuan: string;
  CoQuanId: string;
  CreatedAt: string;
  CreatedBy: string;
}

interface CoQuan {
  Id: number;
  TenCoQuan: string;
}
interface VanBan {
  HoSoId: number;
  VanBanId: number;
  TieuDe: string;
  FilePath: string;
  MaLoai: string;
  TenLoaiVanBan: string;
  CreatedAt: string;
  CreatedBy: string;
}

export default function HoSoThanhToan() {
  const [open, setOpen] = useState(false);
  const [vanBans, setVanBans] = useState<VanBan[]>([]);
  const [file, setFile] = useState<File | null>(null);

  const [openDialog, setOpenDialog] = useState(false);
  const [hoSoId, setHoSoId] = useState<number | null>(null);
  const [openAddVanBanDialog, setOpenAddVanBanDialog] = useState(false);
  const [vanBanForm, setVanBanForm] = useState({
    TieuDe: "",
    LoaiVanBanId: "",
    File: null as File | null,
  });

  const [pdfDialogOpen, setPdfDialogOpen] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [form, setForm] = useState({
    TenHoSo: "",
    CoQuanId: "",
    GhiChu: "",
  });
  const [lookup, setLookup] = useState<{
    loaiVanBan: { Id: number; TenLoaiVanBan: string; MaLoai: string }[];
    coQuan: CoQuan[];
  }>({
    loaiVanBan: [],
    coQuan: [],
  });
  const [editingHoSo, setEditingHoSo] = useState<HoSoThanhToan | null>(null);
  const [editingVanBan, setEditingVanBan] = useState<VanBan | null>(null);
  const [hoSoThanhToans, setHoSoThanhToans] = useState<HoSoThanhToan[]>([]);
  const role = localStorage.getItem("role");
  const coQuanId = localStorage.getItem("coQuanId");
  const userId = localStorage.getItem("userId");

  const resetForm = () => {
    setForm({
      TenHoSo: "",
      CoQuanId: "",
      GhiChu: "",
    });
  };

  const loadHoSoThanhToans = async () => {
    try {
      const lookupRes = await fetchLookup();
      setLookup(lookupRes.data);

      let idCQ: string | null = null;
      if (role !== "admin") {
        idCQ = coQuanId || null;
      }

      const hoSoThanhToanRes = await fetchHoSoThanhToan(idCQ);
      setHoSoThanhToans(hoSoThanhToanRes.data);
    } catch (err) {
      console.error("Lỗi khi load dữ liệu:", err);
    }
  };

  const handleSubmit = async () => {
    if (!form.TenHoSo || (!form.CoQuanId && role === "admin")) {
      toast.error("Vui lòng điền đầy đủ thông tin");
      return;
    }

    const formData = new FormData();
    for (const key in form) {
      formData.append(key, form[key as keyof typeof form]);
    }

    if (editingHoSo) {
      formData.append("Id", editingHoSo.Id.toString());
      formData.append("UpdatedBy", userId || "");
      try {
        await updateHoSoThanhToan(formData);
        toast.success("Cập nhật hồ sơ thành công");
      } catch (err) {
        console.error(err);
        toast.error("Lỗi khi cập nhật hồ sơ");
      }
    } else {
      formData.append("CreatedBy", userId || "");
      if (role !== "admin") {
        formData.set("CoQuanId", coQuanId || "");
      }
      try {
        await uploadHoSoThanhToan(formData);
        toast.success("Đã thêm hồ sơ thành công");
      } catch (err) {
        console.error(err);
        toast.error("Lỗi khi thêm hồ sơ");
      }
    }

    setOpen(false);
    resetForm();
    setEditingHoSo(null);
    loadHoSoThanhToans();
  };

  const onEditClick = (row: HoSoThanhToan) => {
    setForm({
      TenHoSo: row.TenHoSo,
      CoQuanId:
        lookup.coQuan
          .find((x) => x.TenCoQuan === row.TenCoQuan)
          ?.Id.toString() || "",
      GhiChu: row.GhiChu,
    });
    console.log("Editing row:", row);
    setEditingHoSo(row);
    setOpen(true);
  };

  const onEditClickVB = (row: VanBan) => {
    setVanBanForm({
      TieuDe: row.TieuDe,
      LoaiVanBanId:
        lookup.loaiVanBan
          .find((x) => x.TenLoaiVanBan === row.TenLoaiVanBan)
          ?.Id.toString() || "",
      File: null,
    });
    console.log("Editing row:", row);
    setEditingVanBan(row);
    setOpenAddVanBanDialog(true);
  };

  const handleRowClick = async (Id: number) => {
    try {
      const res = await fetchVanBanByHoSo(Id);
      setVanBans(res.data);
      setHoSoId(Id);
      setOpenDialog(true);
    } catch (err) {
      console.error("Lỗi khi load văn bản:", err);
    }
  };

  const handleRowClickPDF = (filePath: string | null) => {
    if (filePath) {
      // C:/HopDong/Upload/2025/... -> /uploads/2025/...
      const relativePath = filePath.replace(
        "C:/DocumentsUpload/HoSoThanhToan/Upload",
        "/uploads_hstt"
      );
      const publicUrl = `${apiConfig.API_BASE_URL}${relativePath}`;
      setPdfUrl(publicUrl);
      setPdfDialogOpen(true);
    }
  };

  const handleUploadVanBan = async () => {
    if (!vanBanForm.TieuDe || !vanBanForm.LoaiVanBanId) {
      toast.error("Vui lòng nhập đầy đủ thông tin");
      return;
    }

    const formData = new FormData();
    formData.append("TieuDe", vanBanForm.TieuDe);
    formData.append("LoaiVanBanId", vanBanForm.LoaiVanBanId);
    formData.append("file", vanBanForm.File || "");

    if (editingVanBan) {
      try {
        formData.append("Id", editingVanBan.VanBanId.toString());
        await updateVanBan(formData);
        toast.success("Cập nhật văn bản thành công");
        const res = await fetchVanBanByHoSo(hoSoId);
        setVanBans(res.data);
      } catch (error) {
        console.error(error);
      }
    } else {
      formData.append("HoSoId", hoSoId?.toString() || "");
      formData.append("CreatedBy", userId || "");
      try {
        // Gọi API upload văn bản (bạn cần viết hoặc đã có trong `hosothanhtoanService`)
        await uploadVanBan(formData);
        toast.success("Thêm văn bản thành công");

        // reload lại danh sách văn bản
        const res = await fetchVanBanByHoSo(hoSoId);
        setVanBans(res.data);
      } catch (err) {
        console.error(err);
        toast.error("Lỗi khi thêm văn bản");
      }
    }
    setOpenAddVanBanDialog(false);
    setVanBanForm({ TieuDe: "", LoaiVanBanId: "", File: null });
    setEditingVanBan(null);
  };

  const handleDeleteHoSoThanhToan = async (id: number) => {
    try {
      await deleteHoSoThanhToan(id);
      toast.success("Đã xóa hồ sơ thanh toán");
      // Cập nhật lại danh sách hồ sơ thanh toán bằng cách lọc bỏ id
      setHoSoThanhToans((prev) => prev.filter((hs) => hs.Id !== id));
    } catch (err) {
      toast.error("Lỗi khi xóa hồ sơ thanh toán");
      console.error(err);
    }
  };

  useEffect(() => {
    loadHoSoThanhToans();
  }, []);

  const formatDate = (date: string) => {
    const iso = new Date(date).toISOString();
    return iso.slice(0, 10).split("-").reverse().join("/");
  };
  const handleCustomChange = (name: string, value: string) => {
    setForm({ ...form, [name]: value });
  };
  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };
  return (
    <div className="p-6">
      <div className="mb-4 flex justify-between items-center bg-gray-100 border rounded p-4">
        <h2 className="text-xl font-bold">Quản lý Hồ sơ thanh toán</h2>
        <Dialog
          open={open}
          onOpenChange={(isOpen) => {
            setOpen(isOpen);
            if (!isOpen) {
              resetForm();
              setEditingHoSo(null);
            }
          }}
        >
          <DialogTrigger asChild>
            <Button variant="default">+ Thêm hồ sơ</Button>
          </DialogTrigger>

          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                {editingHoSo ? "Sửa hồ sơ" : "Thêm hồ sơ"}
              </DialogTitle>
            </DialogHeader>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
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

              <div>
                <label
                  htmlFor="DoiTacId"
                  className="block text-sm font-medium mb-1"
                >
                  Tên hồ sơ
                </label>
                <Input
                  placeholder="Tên hồ sơ"
                  name="TenHoSo"
                  value={form.TenHoSo}
                  onChange={handleChange}
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
      <div className="p-4">
        <h2 className="text-xl font-bold mb-4">Danh sách Hợp đồng</h2>
        <div className="border rounded-md overflow-auto max-h-[600px]">
          <Table>
            <TableHeader className="bg-gray-100">
              <TableRow>
                <TableHead>
                  <div className="flex items-center gap-1">Số hồ sơ</div>
                </TableHead>
                <TableHead>Tên hồ sơ</TableHead>
                <TableHead>Cơ quan</TableHead>
                <TableHead>Ngày tạo</TableHead>
                <TableHead>Ghi chú</TableHead>
                <TableHead>Thao tác</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {hoSoThanhToans.map((row) => (
                <TableRow
                  key={row.Id}
                  className="cursor-pointer hover:bg-gray-100 h-12"
                  onClick={() => handleRowClick(row.Id)}
                >
                  <TableCell>{row.SoHoSo}</TableCell>
                  <TableCell>{row.TenHoSo}</TableCell>
                  <TableCell>{row.TenCoQuan}</TableCell>
                  <TableCell>{formatDate(row.CreatedAt)}</TableCell>
                  <TableCell title={row.GhiChu}>
                    {row.GhiChu.length > 100
                      ? row.GhiChu.slice(0, 100) + "..."
                      : row.GhiChu}
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <div className="flex gap-2">
                      {/* ✅ Tất cả role đều được sửa */}
                      <button
                        className="text-blue-600 hover:underline"
                        onClick={() => onEditClick(row)}
                      >
                        Sửa
                      </button>

                      {/* ❌ Chỉ admin mới được xóa */}
                      {role === "admin" && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <button className="text-red-600 hover:underline">
                              Xóa
                            </button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>
                                Bạn có chắc muốn xóa hợp đồng?
                              </AlertDialogTitle>
                              <AlertDialogDescription>
                                Thao tác này không thể hoàn tác. File PDF cũng
                                sẽ bị xóa nếu có.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Hủy</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() =>
                                  handleDeleteHoSoThanhToan(row.Id)
                                }
                              >
                                Xóa
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Dialog open={openDialog} onOpenChange={setOpenDialog}>
            <DialogContent className="sm:max-w-6xl max-h-[80vh] ">
              <DialogHeader>
                <DialogTitle>Danh sách văn bản</DialogTitle>
              </DialogHeader>
              <div className="max-h-[60vh] overflow-auto mt-4">
                <Table>
                  <TableHeader className="bg-gray-100">
                    <TableRow>
                      <TableHead>Tiêu đề</TableHead>
                      <TableHead>Loại văn bản</TableHead>
                      <TableHead>Ngày tạo</TableHead>
                      <TableHead>File</TableHead>
                      <TableHead>Thao tác</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {vanBans.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={4}
                          className="text-center italic text-gray-500"
                        >
                          Không có văn bản nào
                        </TableCell>
                      </TableRow>
                    ) : (
                      vanBans.map((vb: VanBan) => (
                        <TableRow
                          key={vb.VanBanId}
                          className="cursor-pointer hover:bg-gray-100 h-12"
                          onClick={() => handleRowClickPDF(vb.FilePath)}
                        >
                          <TableCell>{vb.TieuDe}</TableCell>
                          <TableCell>
                            {vb.TenLoaiVanBan} ({vb.MaLoai})
                          </TableCell>
                          <TableCell>
                            {new Date(vb.CreatedAt).toLocaleDateString()}
                          </TableCell>
                          <TableCell>{vb.FilePath}</TableCell>
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <div className="flex gap-2">
                              {/* ✅ Tất cả role đều được sửa */}
                              <button
                                className="text-blue-600 hover:underline"
                                onClick={() => onEditClickVB(vb)}
                              >
                                Sửa
                              </button>

                              {/* ❌ Chỉ admin mới được xóa */}
                              {role === "admin" && (
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <button className="text-red-600 hover:underline">
                                      Xóa
                                    </button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>
                                        Bạn có chắc muốn xóa hợp đồng?
                                      </AlertDialogTitle>
                                      <AlertDialogDescription>
                                        Thao tác này không thể hoàn tác. File
                                        PDF cũng sẽ bị xóa nếu có.
                                      </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel>Hủy</AlertDialogCancel>
                                      <AlertDialogAction
                                        onClick={() =>
                                          handleDeleteHoSoThanhToan(vb.Id)
                                        }
                                      >
                                        Xóa
                                      </AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
              <DialogFooter className="mt-4 flex justify-end">
                <Button onClick={() => setOpenAddVanBanDialog(true)}>
                  + Thêm văn bản
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog
            open={openAddVanBanDialog}
            onOpenChange={setOpenAddVanBanDialog}
          >
            <DialogContent className="sm:max-w-xl">
              <DialogHeader>
                <DialogTitle>
                  {editingVanBan ? "Sửa văn bản" : "Thêm văn bản"}
                </DialogTitle>
              </DialogHeader>

              <div className="grid gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Tiêu đề
                  </label>
                  <Input
                    name="TieuDe"
                    value={vanBanForm.TieuDe}
                    onChange={(e) =>
                      setVanBanForm({ ...vanBanForm, TieuDe: e.target.value })
                    }
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">
                    Loại văn bản
                  </label>
                  <select
                    className="w-full border rounded px-2 py-1"
                    value={vanBanForm.LoaiVanBanId}
                    onChange={(e) =>
                      setVanBanForm({
                        ...vanBanForm,
                        LoaiVanBanId: e.target.value,
                      })
                    }
                  >
                    <option value="">-- Chọn loại văn bản --</option>
                    {lookup.loaiVanBan.map((lvb) => (
                      <option key={lvb.Id} value={lvb.Id}>
                        {lvb.TenLoaiVanBan} ({lvb.MaLoai})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">File</label>
                  <Input
                    type="file"
                    accept=".pdf,.doc,.docx"
                    required
                    onChange={(e) => {
                      setVanBanForm({
                        ...vanBanForm,
                        File: e.target.files ? e.target.files[0] : null,
                      });
                      setFile(e.target.files ? e.target.files[0] : null);
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
                <Button onClick={handleUploadVanBan}>Lưu</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </div>
  );
}

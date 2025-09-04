import { useEffect, useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { Funnel } from "lucide-react";
import { toast } from "sonner";
import axios from "axios";
import apiConfig from "../../apiConfig.json";

const lookupTypes = [
  { key: "loaiVanBan", label: "Loại văn bản" },
  { key: "coQuan", label: "Cơ quan" },
  { key: "nguoiKy", label: "Người ký" },
];

interface LoaiVanBan {
  Id: number;
  TenLoai: string;
  KyHieu: string;
}

interface CoQuan {
  Id: number;
  TenCoQuan: string;
  TenVietTat: string;
}

interface NguoiKy {
  Id: number;
  HoTen: string;
  ChucVu: string;
}

type LookupItem = LoaiVanBan | CoQuan | NguoiKy;
const getItemName = (item: LookupItem): string => {
  return (
    (item as LoaiVanBan).TenLoai ||
    (item as CoQuan).TenCoQuan ||
    (item as NguoiKy).HoTen ||
    "Không rõ"
  );
};

export default function LookupManager() {
  const [selectedType, setSelectedType] = useState("loaiVanBan");
  const [data, setData] = useState<LookupItem[]>([]);
  const [name, setName] = useState("");
  const [shortName, setShortName] = useState(""); // Thêm viết tắt
  const [editId, setEditId] = useState<number | null>(null);
  const [openDialog, setOpenDialog] = useState(false);
  const [filterValue, setFilterValue] = useState("");

  const isCoQuan = selectedType === "coQuan";
  const isNguoiKy = selectedType === "nguoiKy";
  const isLoaiVanBan = selectedType === "loaiVanBan";

  const filteredData = useMemo(() => {
    return data.filter((item) =>
      getItemName(item).toLowerCase().includes(filterValue.toLowerCase())
    );
  }, [data, filterValue]);

  const fetchLookup = async () => {
    try {
      const res = await axios.get(
        `${apiConfig.API_BASE_URL}/vanbandi/lookup-vanbandi`
      );
      const items = res.data[selectedType] || [];
      setData([...items]); // ép tạo mảng mới
      console.log("Danh mục đã tải:", items);
    } catch (err) {
      toast.error("Lỗi khi tải danh mục");
      console.error(err);
    }
  };

  useEffect(() => {
    fetchLookup();
  }, [selectedType]);

  const handleSave = async () => {
    if (!name.trim()) return toast.error("Không được để trống tên");
    if (isCoQuan && !shortName.trim()) return toast.error("Thiếu tên viết tắt");

    try {
      const endpoint = `${apiConfig.API_BASE_URL}/vanbandi/lookup/${selectedType}`;
      const payload: Record<string, string> = { name };
      if (isCoQuan || isNguoiKy || isLoaiVanBan) {
        payload.shortName = shortName;
      }

      if (editId) {
        await axios.put(`${endpoint}/${editId}`, payload);
        toast.success("Đã cập nhật");
      } else {
        await axios.post(endpoint, payload);
        toast.success("Đã thêm mới");
      }

      await fetchLookup();
      setOpenDialog(false);
      setName("");
      setShortName("");
      setEditId(null);
    } catch (err) {
      toast.error("Lỗi khi lưu dữ liệu");
      console.error(err);
    }
  };

  const handleEdit = (item: LookupItem) => {
    let name = "";
    let short = "";

    if ("TenLoai" in item) {
      name = item.TenLoai;
      short = item.KyHieu;
    } else if ("TenCoQuan" in item) {
      name = item.TenCoQuan;
      short = item.TenVietTat;
    } else if ("HoTen" in item) {
      name = item.HoTen;
      short = item.ChucVu;
    }
    setName(name);
    setShortName(short);
    setEditId(item.Id);
    setOpenDialog(true);
  };

  const handleDelete = async (id: number) => {
    try {
      await axios.delete(
        `${apiConfig.API_BASE_URL}/vanbandi/lookup/${selectedType}/${id}`
      );
      toast.success("Đã xóa");
      await fetchLookup();
    } catch (err) {
      toast.error("Lỗi khi xóa");
      console.error(err);
    }
  };

  const getItemShort = (item: LookupItem): string | null => {
    if ("TenVietTat" in item) return item.TenVietTat;
    if ("ChucVu" in item) return item.ChucVu;
    if ("KyHieu" in item) return item.KyHieu;
    return null;
  };

  return (
    <div className="p-6">
      <h2 className="text-xl font-bold mb-4">Quản lý danh mục</h2>

      <div className="flex items-center gap-4 mb-4">
        <Select value={selectedType} onValueChange={setSelectedType}>
          <SelectTrigger className="w-[250px]">
            <SelectValue placeholder="Chọn danh mục" />
          </SelectTrigger>
          <SelectContent>
            {lookupTypes.map((item) => (
              <SelectItem key={item.key} value={item.key}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Dialog open={openDialog} onOpenChange={setOpenDialog}>
          <DialogTrigger asChild>
            <Button
              onClick={() => {
                setEditId(null);
                setName("");
                setShortName("");
              }}
            >
              + Thêm
            </Button>
          </DialogTrigger>

          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {editId ? "Chỉnh sửa" : "Thêm mới"}{" "}
                {lookupTypes.find((l) => l.key === selectedType)?.label}
              </DialogTitle>
            </DialogHeader>

            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nhập tên..."
              className="mb-2"
            />
            {isCoQuan && (
              <Input
                value={shortName}
                onChange={(e) => setShortName(e.target.value)}
                placeholder="Nhập tên viết tắt..."
              />
            )}
            {isNguoiKy && (
              <Input
                value={shortName}
                onChange={(e) => setShortName(e.target.value)}
                placeholder="Nhập chức vụ..."
              />
            )}
            {isLoaiVanBan && (
              <Input
                value={shortName}
                onChange={(e) => setShortName(e.target.value)}
                placeholder="Nhập ký hiệu..."
              />
            )}
            <DialogFooter>
              <Button onClick={handleSave}>
                {editId ? "Lưu thay đổi" : "Thêm mới"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="border rounded-md">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-100 text-left">
            <tr>
              <th className="p-2">#</th>
              <th className="p-2">
                <div className="flex items-center gap-1">
                  Tên
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        className="p-1 hover:bg-gray-200 rounded"
                        title="Lọc tên"
                      >
                        <Funnel className="w-3 h-3 text-gray-500" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-48">
                      <Input
                        placeholder="Nhập từ khóa..."
                        value={filterValue}
                        onChange={(e) => setFilterValue(e.target.value)}
                      />
                      <div className="mt-2 text-sm text-gray-500">
                        Lọc theo tên danh mục
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              </th>
              {(isCoQuan || isNguoiKy || isLoaiVanBan) && (
                <th className="p-2">
                  {isCoQuan ? "Viết tắt" : isNguoiKy ? "Chức vụ" : "Ký hiệu"}
                </th>
              )}
              <th className="p-2 text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {filteredData.map((item, idx) => {
              const name = getItemName(item);
              const short = getItemShort(item);
              return (
                <tr key={item.Id} className="border-t">
                  <td className="p-2">{idx + 1}</td>
                  <td className="p-2">{name}</td>
                  {(isCoQuan || isNguoiKy || isLoaiVanBan) && (
                    <td className="p-2">{short}</td>
                  )}
                  <td className="p-2 text-right space-x-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleEdit(item)}
                    >
                      Sửa
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="sm" variant="destructive">
                          Xóa
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            Bạn có chắc muốn xóa mục này?
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            Thao tác này không thể hoàn tác. Dữ liệu sẽ bị xóa
                            vĩnh viễn.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Hủy</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => handleDelete(item.Id)}
                          >
                            Xóa
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </td>
                </tr>
              );
            })}
            {data.length === 0 && (
              <tr>
                <td
                  colSpan={isCoQuan ? 4 : 3}
                  className="p-4 text-center text-muted-foreground"
                >
                  Không có dữ liệu
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

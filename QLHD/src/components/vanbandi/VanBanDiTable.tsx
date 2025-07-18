import React, { useState, useMemo } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Funnel } from "lucide-react";
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

interface VanBanDiTableProps {
  data: VanBanDi[];
  onRowClick?: (filePath: string | null) => void;
  onEdit?: (vanBan: VanBanDi) => void;
  onDelete?: (id: number) => void;
  role?: string | null;
}

const VanBanDiTable: React.FC<VanBanDiTableProps> = ({
  data,
  onRowClick,
  onEdit,
  onDelete,
  role,
}) => {
  const [filterValue, setFilterValue] = useState("");

  const filteredData = useMemo(() => {
    return data.filter((row) =>
      row.SoVanBan.toLowerCase().includes(filterValue.toLowerCase())
    );
  }, [data, filterValue]);

  const formatDate = (date: string) => {
    const iso = new Date(date).toISOString();
    return iso.slice(0, 10).split("-").reverse().join("/");
  };

  if (!data.length) return <div className="p-4">Đang tải...</div>;

  return (
    <div className="p-4">
      <h2 className="text-xl font-bold mb-4">Danh sách Văn bản đi</h2>
      <div className="border rounded-md overflow-auto max-h-[600px]">
        <Table>
          <TableHeader className="bg-gray-100">
            <TableRow>
              <TableHead>
                <div className="flex items-center gap-1">
                  Số văn bản
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        className="p-1 hover:bg-gray-200 rounded"
                        title="Lọc Số VB"
                      >
                        <Funnel className="w-3 h-3 text-gray-500" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-48">
                      <Input
                        placeholder="Nhập Số văn bản..."
                        value={filterValue}
                        onChange={(e) => setFilterValue(e.target.value)}
                      />
                      <div className="mt-2 text-sm text-gray-500">
                        Lọc theo Số văn bản
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              </TableHead>
              <TableHead>Tên văn bản</TableHead>
              <TableHead>Loại văn bản</TableHead>
              <TableHead>Ngày VB</TableHead>
              <TableHead>Người ký</TableHead>
              <TableHead>Nơi nhận</TableHead>
              <TableHead>Số bản</TableHead>
              <TableHead>Ngày chuyển</TableHead>
              <TableHead>Ghi chú</TableHead>
              <TableHead>Cơ quan</TableHead>
              <TableHead>Ngày tạo</TableHead>
              <TableHead>Thao tác</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredData.map((row) => (
              <TableRow
                key={row.Id}
                className="cursor-pointer hover:bg-gray-100 h-12"
                onClick={() => onRowClick?.(row.FilePath ?? null)}
              >
                <TableCell>{row.SoVanBan}</TableCell>
                <TableCell>{row.TenVanBan}</TableCell>
                <TableCell>{row.LoaiVanBan}</TableCell>
                <TableCell>{formatDate(row.NgayVanBan)}</TableCell>
                <TableCell>{row.NguoiKy}</TableCell>
                <TableCell>{row.NoiNhan}</TableCell>
                <TableCell>{row.SoLuongBan}</TableCell>
                <TableCell>{formatDate(row.NgayChuyen)}</TableCell>
                <TableCell>{row.GhiChu}</TableCell>
                <TableCell>{row.NoiNhan}</TableCell>
                <TableCell>{formatDate(row.CreatedAt)}</TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <div className="flex gap-2">
                    <button
                      className="text-blue-600 hover:underline"
                      onClick={() => onEdit?.(row)}
                    >
                      Sửa
                    </button>

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
                              Bạn có chắc muốn xóa văn bản?
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              Hành động này không thể hoàn tác. File đính kèm
                              (nếu có) cũng sẽ bị xóa.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Hủy</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => onDelete?.(row.Id)}
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
      </div>
    </div>
  );
};

export default VanBanDiTable;

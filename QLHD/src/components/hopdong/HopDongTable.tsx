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

interface HopDongTableProps {
  onRowClick?: (filePath: string | null) => void;
  data: HopDong[];
  role?: string | null;
  onDelete?: (id: number) => void;
}

const HopDongTable: React.FC<HopDongTableProps> = ({
  onRowClick,
  data,
  role,
  onDelete,
}) => {
  const [filterValue, setFilterValue] = useState("");

  const filteredData = useMemo(() => {
    return data.filter((row) =>
      row.SoVanBanNoiBo.toLowerCase().includes(filterValue.toLowerCase())
    );
  }, [data, filterValue]);

  const formatDate = (date: string) => {
    const iso = new Date(date).toISOString();
    return iso.slice(0, 10).split("-").reverse().join("/");
  };

  if (!data.length) return <div className="p-4">Đang tải...</div>;

  return (
    <div className="p-4">
      <h2 className="text-xl font-bold mb-4">Danh sách Hợp đồng</h2>
      <div className="border rounded-md overflow-x-auto">
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
                        Lọc theo Số văn bản nội bộ
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              </TableHead>
              <TableHead>Ngày ĐK</TableHead>
              <TableHead>Loại văn bản</TableHead>
              <TableHead>Cơ quan</TableHead>
              <TableHead>Hệ thống</TableHead>
              <TableHead>Đối tác</TableHead>
              <TableHead>Trích yếu</TableHead>
              <TableHead>Tình trạng</TableHead>
              <TableHead>Ghi chú</TableHead>
              <TableHead>Ngày tạo</TableHead>
              <TableHead>Ngày cập nhật</TableHead>
              {role === "admin" && <TableHead>Thao tác</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredData.map((row) => (
              <TableRow
                key={row.Id}
                className="cursor-pointer hover:bg-gray-100"
                onClick={() => onRowClick?.(row.FilePath ?? null)}
              >
                <TableCell>{row.SoVanBanNoiBo}</TableCell>
                <TableCell>{formatDate(row.NgayDangKy)}</TableCell>
                <TableCell>{row.LoaiVanBan}</TableCell>
                <TableCell>{row.TenCoQuan}</TableCell>
                <TableCell>{row.TenHeThong}</TableCell>
                <TableCell>{row.TenDoiTac}</TableCell>
                <TableCell>{row.TrichYeu}</TableCell>
                <TableCell>{row.TinhTrang}</TableCell>
                <TableCell>{row.GhiChu}</TableCell>
                <TableCell>{formatDate(row.CreatedAt)}</TableCell>
                <TableCell>{formatDate(row.UpdatedAt)}</TableCell>
                {role === "admin" && (
                  <TableCell onClick={(e) => e.stopPropagation()}>
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
                            Thao tác này không thể hoàn tác. File PDF cũng sẽ bị
                            xóa nếu có.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Hủy</AlertDialogCancel>
                          <AlertDialogAction onClick={() => onDelete?.(row.Id)}>
                            Xóa
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};

export default HopDongTable;

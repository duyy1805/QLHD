// App.jsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import axios, { AxiosError } from "axios";

import apiConfig from "../../apiConfig.json";
// Biểu tượng SVG đơn giản cho logo
const CustomLogo = () => (
  <img src="/vite.svg" alt="Vite Logo" className="h-10 w-10" />
);

// Biểu tượng Google và GitHub (thay thế bằng biểu tượng thực nếu bạn có font-awesome hoặc lucide-react)
const GoogleIcon = () => (
  <svg
    className="w-4 h-4 mr-2"
    viewBox="0 0 48 48"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      fill="#FFC107"
      d="M43.6 20.5H42V20H24v8h11.3C34.6 32 30 35 24 35c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l6-6C34.1 4.4 29.3 2 24 2 12.4 2 3 11.4 3 23s9.4 21 21 21c11 0 20.5-8 20.5-21 0-1.2-.1-2.3-.3-3.5z"
    />
    <path
      fill="#FF3D00"
      d="M6.3 14.7l6.6 4.8C14.2 16 18.7 13 24 13c3.1 0 5.9 1.2 8 3.1l6-6C34.1 4.4 29.3 2 24 2 16.2 2 9.5 6.4 6.3 14.7z"
    />
    <path
      fill="#4CAF50"
      d="M24 44c5.9 0 11-2 14.8-5.4l-6.8-5.6C29.6 34.6 26.9 36 24 36c-6 0-11.1-4-12.9-9.5l-6.7 5.2C8.7 39.4 15.8 44 24 44z"
    />
    <path
      fill="#1976D2"
      d="M43.6 20.5H42V20H24v8h11.3C34.3 32 29.8 35 24 35c-6.6 0-12-5.4-12-12 0-1.3.2-2.5.6-3.6l-6.6-4.8C4.7 18 4 20.4 4 23c0 11.6 9.4 21 21 21 11 0 20.5-8 20.5-21 0-1.2-.1-2.3-.3-3.5z"
    />
  </svg>
);

const GitHubIcon = () => (
  <svg
    className="w-4 h-4 mr-2"
    viewBox="0 0 24 24"
    fill="currentColor"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      fillRule="evenodd"
      d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.007-.866-.013-1.7-2.782.604-3.369-1.341-3.369-1.341-.454-1.157-1.11-1.465-1.11-1.465-.908-.619.069-.607.069-.607 1.004.07 1.531 1.029 1.531 1.029.892 1.529 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.112-4.555-4.945 0-1.09.39-1.984 1.029-2.68A4.322 4.322 0 0 1 5.42 8.02c-.1-.253-.446-1.267.069-2.64 0 0 .84-.268 2.75 1.026A9.555 9.555 0 0 1 12 5.672c.85.006 1.7.113 2.5.334 1.91-1.294 2.75-1.026 2.75-1.026.516 1.373.17 2.387.069 2.64a4.322 4.322 0 0 1 1.029 2.68c0 3.841-2.339 4.686-4.566 4.935.359.308.678.917.678 1.846 0 1.338-.013 2.417-.013 2.747 0 .268.18.579.688.482C21.137 20.197 24 16.43 24 12.017 24 6.484 19.522 2 14 2h-2z"
    />
  </svg>
);

export default function App() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const navigate = useNavigate();

  const handleLogin = async () => {
    try {
      const res = await axios.post(`${apiConfig.API_BASE_URL}/auth/login`, {
        username,
        password,
      });

      if (res.data.success) {
        const { accessToken, role, coQuanId } = res.data;

        // ✅ Lưu token vào localStorage (nếu cần dùng để xác thực)
        localStorage.setItem("accessToken", accessToken);
        localStorage.setItem("role", role);
        localStorage.setItem("coQuanId", coQuanId);

        // ✅ Điều hướng theo vai trò
        if (role === "admin") {
          navigate("/admin");
        } else {
          navigate("/hopdong"); // Hoặc trang phù hợp với vai trò khác
        }
      } else {
        alert("Đăng nhập không thành công!");
      }
    } catch (err: unknown) {
      const error = err as AxiosError<{ message: string }>;

      if (error.response?.data?.message) {
        alert(error.response.data.message);
      } else {
        alert("Lỗi hệ thống, vui lòng thử lại.");
      }
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-background text-foreground p-4 sm:p-6">
      {/* Logo và Tiêu đề */}
      <div className="flex flex-col items-center mb-8 space-y-4">
        <CustomLogo />
        <h1 className="text-3xl font-bold tracking-tight text-center">
          Quản lý hợp đồng
        </h1>
      </div>

      {/* Card chứa form đăng nhập */}
      <Card className="w-full max-w-md shadow-lg rounded-xl">
        <CardHeader className="text-center pb-4">
          <CardDescription>Login</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Email Address */}
          <div className="space-y-2">
            <Label htmlFor="username">Username</Label>
            <Input
              id="username"
              placeholder="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>

          {/* Password */}
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              placeholder="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {/* Remember me và Forgot password */}
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center space-x-2">
              <Checkbox id="remember-me" />
              <Label
                htmlFor="remember-me"
                className="peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                Remember me
              </Label>
            </div>
            <a href="#" className="text-primary hover:underline">
              Forgot password?
            </a>
          </div>

          {/* Nút Sign In */}
          <Button className="w-full py-2.5" onClick={handleLogin}>
            Sign in
          </Button>

          {/* Hoặc tiếp tục với */}
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-muted" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">
                Or continue with
              </span>
            </div>
          </div>

          {/* Nút đăng nhập xã hội */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Button variant="outline" className="w-full py-2.5">
              <GoogleIcon />
              Google
            </Button>
            <Button variant="outline" className="w-full py-2.5">
              <GitHubIcon />
              GitHub
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Footer link */}
      <div className="mt-8 text-sm text-muted-foreground">
        Not a member?{" "}
        <a href="#" className="text-primary hover:underline">
          Liên hệ ban CNTT
        </a>
      </div>
    </div>
  );
}

// src/App.tsx

import { BrowserRouter, Routes, Route } from "react-router-dom";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import AppLayout from "./layouts/AppLayout";
import HopDong from "./pages/HopDong";
import { Toaster } from "sonner";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Route không có layout */}
        <Route path="/" element={<Login />} />
        {/* Route dùng layout AppLayout */}
        <Route element={<AppLayout />}>
          <Route path="/hopdong" element={<HopDong />} />
          <Route path="/dashboard" element={<Dashboard />} />
        </Route>
      </Routes>
      <Toaster richColors position="top-center" />
    </BrowserRouter>
  );
}

export default App;

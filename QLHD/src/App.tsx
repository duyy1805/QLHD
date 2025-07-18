// src/App.tsx

import { BrowserRouter, Routes, Route } from "react-router-dom";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import AppLayout from "./layouts/AppLayout";
import LookupManager from "./pages/LookupManager";
import HopDong from "./pages/HopDong";
import VanBanDi from "./pages/VanBanDi";
import { Toaster } from "sonner";
import ProtectedRoute from "./components/ProtectedRoute";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Route không có layout */}
        <Route path="/" element={<Login />} />
        {/* Route dùng layout AppLayout */}
        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route path="/hopdong" element={<HopDong />} />
            <Route path="/vanbandi" element={<VanBanDi />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/lookup" element={<LookupManager />} />
          </Route>
        </Route>
      </Routes>
      <Toaster richColors position="top-center" />
    </BrowserRouter>
  );
}

export default App;

// src/App.tsx

import { BrowserRouter, Routes, Route } from "react-router-dom";
import Login from "./pages/Login";
// import Dashboard from "./pages/Dashboard";
import AppLayout from "./layouts/AppLayout";
import LookupHDManager from "./pages/Lookup_HD_Manager";
import LookupVBDManager from "./pages/Lookup_VBD_Manager";
import HopDong from "./pages/HopDong";
import VanBanDi from "./pages/VanBanDi";
import HoSoThanhToan from "./pages/HoSoThanhToan";
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
            <Route path="/document">
              <Route path="hopdong" element={<HopDong />} />
              <Route path="vanbandi" element={<VanBanDi />} />
              <Route path="hosothanhtoan" element={<HoSoThanhToan />} />
            </Route>
            <Route path="/hosothanhtoan" element={<HoSoThanhToan />} />
            <Route path="/lookup/hopdong" element={<LookupHDManager />} />
            <Route path="/lookup/vanbandi" element={<LookupVBDManager />} />
          </Route>
        </Route>
      </Routes>
      <Toaster richColors position="top-center" />
    </BrowserRouter>
  );
}

export default App;

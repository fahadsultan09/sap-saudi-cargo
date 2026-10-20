import { useCallback, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import Shell from "./components/Shell";
import Home from "./pages/Home";
import Upload from "./pages/Upload";
import Review from "./pages/Review";
import { loadUserId } from "./lib/config";

export default function App() {
  const [userId, setUserId] = useState(loadUserId);
  const [toast, setToast] = useState("");

  const showToast = useCallback((message) => {
    setToast(message);
    window.clearTimeout(showToast._t);
    showToast._t = window.setTimeout(() => setToast(""), 3200);
  }, []);

  return (
    <Routes>
      <Route element={<Shell userId={userId} onUserChange={setUserId} toast={toast} />}>
        <Route index element={<Home userId={userId} showToast={showToast} />} />
        <Route path="upload" element={<Upload userId={userId} showToast={showToast} />} />
        <Route path="review/:caseId" element={<Review userId={userId} showToast={showToast} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

import React, { useCallback, useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import Shell from "./components/Shell";
import Home from "./pages/Home";
import Process from "./pages/Process";
import Review from "./pages/Review";
import Desk from "./pages/Desk";
import Approvals from "./pages/Approvals";
import { fetchSession } from "./lib/api";
import { getUser, loadUserId, saveUserId } from "./lib/config";

export default function App() {
  const [userId, setUserId] = useState(loadUserId);
  const [toast, setToast] = useState("");
  const [session, setSession] = useState(null);

  const showToast = useCallback((message) => {
    setToast(message);
    window.clearTimeout(showToast._t);
    showToast._t = window.setTimeout(() => setToast(""), 3200);
  }, []);

  const refreshSession = useCallback(async () => {
    const me = await fetchSession();
    setSession(me);
    return me;
  }, []);

  useEffect(() => {
    refreshSession();
  }, [userId, refreshSession]);

  function onUserChange(id) {
    saveUserId(id);
    setUserId(id);
  }

  const localUser = getUser(userId);

  return (
    <Routes>
      <Route
        element={
          <Shell
            userId={userId}
            onUserChange={onUserChange}
            toast={toast}
            session={session}
            localUser={localUser}
          />
        }
      >
        <Route index element={<Home userId={userId} showToast={showToast} />} />
        <Route path="home" element={<Home userId={userId} showToast={showToast} />} />
        
        {/* Worklist / Desk */}
        <Route path="worklist" element={<Desk userId={userId} showToast={showToast} />} />
        <Route path="desk" element={<Desk userId={userId} showToast={showToast} />} />
        
        {/* Approvals */}
        <Route path="approvals" element={<Approvals userId={userId} showToast={showToast} />} />
        <Route path="need-review" element={<Approvals userId={userId} showToast={showToast} />} />
        
        {/* Case Review Detail */}
        <Route
          path="cases/:caseId"
          element={
            <Review userId={userId} onUserChange={onUserChange} showToast={showToast} />
          }
        />
        <Route
          path="review/:caseId"
          element={
            <Review userId={userId} onUserChange={onUserChange} showToast={showToast} />
          }
        />

        {/* Process / Intake */}
        <Route path="intake" element={<Process showToast={showToast} />} />
        <Route path="process/:caseId" element={<Process showToast={showToast} />} />
        <Route path="process/new" element={<Process showToast={showToast} />} />
        <Route path="upload" element={<Navigate to="/intake" replace />} />

        {/* Catch-all redirect */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

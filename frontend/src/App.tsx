import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Intro from './pages/Intro';
import Dashboard from './pages/Dashboard';
import Properties from './pages/Properties';
import Tenants from './pages/Tenants';
import Contracts from './pages/Contracts';
import Finance from './pages/Finance';
import CollectionWorkbench from './pages/CollectionWorkbench';
import RentManagement from './pages/RentManagement';
import UtilityBills from './pages/UtilityBills';
import PrepaidMeter from './pages/PrepaidMeter';
import ExpenseRecords from './pages/ExpenseRecords';
import Reconciliation from './pages/Reconciliation';
import TaxReport from './pages/TaxReport';
import Maintenance from './pages/Maintenance';
import Settings from './pages/Settings';
import SignContract from './pages/SignContract';
import Listings from './pages/Listings';
import ROIAnalysis from './pages/ROIAnalysis';
import RentComps from './pages/RentComps';
import RentBell from './pages/RentBell';
import RentStats from './pages/RentStats';

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex items-center justify-center h-screen text-gray-400">載入中...</div>;
  return user ? <>{children}</> : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/intro" element={<Intro />} />
          <Route path="/sign/:token" element={<SignContract />} />
          <Route
            path="/"
            element={
              <PrivateRoute>
                <Layout />
              </PrivateRoute>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="properties" element={<Properties />} />
            <Route path="tenants" element={<Tenants />} />
            <Route path="finance" element={<Finance />} />
            <Route path="finance/workbench" element={<CollectionWorkbench />} />
            <Route path="finance/rent" element={<RentManagement />} />
            <Route path="finance/bell" element={<RentBell />} />
            <Route path="finance/stats" element={<RentStats />} />
            <Route path="finance/utilities" element={<UtilityBills />} />
            <Route path="finance/prepaid" element={<PrepaidMeter />} />
            <Route path="finance/reconcile" element={<Reconciliation />} />
            <Route path="finance/expenses" element={<ExpenseRecords />} />
            <Route path="finance/tax" element={<TaxReport />} />
            <Route path="contracts" element={<Contracts />} />
            <Route path="listings" element={<Listings />} />
            <Route path="roi" element={<ROIAnalysis />} />
            <Route path="market" element={<RentComps />} />
            <Route path="maintenance" element={<Maintenance />} />
            <Route path="settings" element={<Settings />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

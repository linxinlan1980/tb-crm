import NotFoundPage from './pages/NotFoundPage';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/useAuthStore';
import BasicLayout from './layouts/BasicLayout';
import LoginPage from './pages/login/LoginPage';
import DashboardPage from './pages/dashboard/DashboardPage';
import CustomerListPage from './pages/customer/CustomerListPage';
import CustomerDetailPage from './pages/customer/CustomerDetailPage';
import PoolPublicPage from './pages/pool/PoolPublicPage';
import PoolPrivatePage from './pages/pool/PoolPrivatePage';
import LeadListPage from './pages/lead/LeadListPage';
import OpportunityBoardPage from './pages/opportunity/OpportunityBoardPage';
import OpportunityListPage from './pages/opportunity/OpportunityListPage';
import ContractListPage from './pages/contract/ContractListPage';
import PaymentPlanPage from './pages/finance/PaymentPlanPage';
import ProjectListPage from './pages/project/ProjectListPage';
import AgingPage from './pages/finance/AgingPage';
import ApprovalCenterPage from './pages/approval/ApprovalCenterPage';
import NotificationCenterPage from './pages/notification/NotificationCenterPage';
import OrderListPage from './pages/order/OrderListPage';
import InvoiceListPage from './pages/finance/InvoiceListPage';

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.accessToken);
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <PrivateRoute>
              <BasicLayout />
            </PrivateRoute>
          }
        >
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="customers" element={<CustomerListPage />} />
          <Route path="customers/:id" element={<CustomerDetailPage />} />
          <Route path="pool/public" element={<PoolPublicPage />} />
          <Route path="pool/private" element={<PoolPrivatePage />} />
          <Route path="leads" element={<LeadListPage />} />
          <Route path="opportunities" element={<OpportunityListPage />} />
          <Route path="opportunities/board" element={<OpportunityBoardPage />} />
          <Route path="contracts" element={<ContractListPage />} />
          <Route path="finance/payment-plans" element={<PaymentPlanPage />} />
          <Route path="projects" element={<ProjectListPage />} />
          <Route path="finance/aging" element={<AgingPage />} />
          <Route path="approvals" element={<ApprovalCenterPage />} />
          <Route path="notifications" element={<NotificationCenterPage />} />
          <Route path="orders" element={<OrderListPage />} />
          <Route path="invoices" element={<InvoiceListPage />} />
          {/* 待补：projects/:id, contracts/:id, system/*, ai/*, reports/* */}
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

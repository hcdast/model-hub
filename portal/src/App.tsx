import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ConfigProvider } from 'antd';
import { antTheme } from './theme/dark';
import AppLayout from './components/Layout/AppLayout';
import ProtectedRoute from './components/Auth/ProtectedRoute';
import './styles/global.css';

const Home = lazy(() => import('./pages/Home'));
const Login = lazy(() => import('./pages/Login'));
const Register = lazy(() => import('./pages/Register'));
const WorkflowEditor = lazy(() => import('./pages/WorkflowEditor'));
const WorkflowList = lazy(() => import('./pages/WorkflowList'));
const TemplateGallery = lazy(() => import('./pages/TemplateGallery'));
const Community = lazy(() => import('./pages/Community'));
const Profile = lazy(() => import('./pages/Profile'));
const ApiKeys = lazy(() => import('./pages/ApiKeys'));

function App() {
  return (
    <ConfigProvider theme={antTheme}>
      <BrowserRouter>
        <Suspense fallback={<div style={{ minHeight: '100vh' }} />}>
          <Routes>
          {/* 公开路由（无需登录） */}
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />

          {/* 受保护路由（需要登录） */}
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <AppLayout>
                  <Home />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/workflows"
            element={
              <ProtectedRoute>
                <AppLayout>
                  <WorkflowList />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/templates"
            element={
              <ProtectedRoute>
                <AppLayout>
                  <TemplateGallery />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/community"
            element={
              <ProtectedRoute>
                <AppLayout>
                  <Community />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/profile"
            element={
              <ProtectedRoute>
                <AppLayout>
                  <Profile />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings/api-keys"
            element={
              <ProtectedRoute>
                <AppLayout>
                  <ApiKeys />
                </AppLayout>
              </ProtectedRoute>
            }
          />

          {/* 画布编辑器（全屏，受保护） */}
          <Route
            path="/workflows/:id"
            element={
              <ProtectedRoute>
                <WorkflowEditor />
              </ProtectedRoute>
            }
          />
          <Route
            path="/workflows/new"
            element={
              <ProtectedRoute>
                <WorkflowEditor />
              </ProtectedRoute>
            }
          />

          {/* 重定向 */}
          <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ConfigProvider>
  );
}

export default App;

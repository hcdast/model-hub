import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useSearchParams } from 'react-router-dom';
import { ConfigProvider } from 'antd';
import enUS from 'antd/locale/en_US';
import zhCN from 'antd/locale/zh_CN';
import jaJP from 'antd/locale/ja_JP';
import { useI18n } from './i18n';
import { antTheme } from './theme/dark';
import AppLayout from './components/Layout/AppLayout';
import ProtectedRoute from './components/Auth/ProtectedRoute';
import { useAuthStore } from './store/auth-store';
import './styles/global.css';

const Home = lazy(() => import('./pages/Home'));
const Login = lazy(() => import('./pages/Login'));
const Register = lazy(() => import('./pages/Register'));
const AuthCallback = lazy(() => import('./pages/AuthCallback'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const Legal = lazy(() => import('./pages/Legal'));
const WorkflowEditor = lazy(() => import('./pages/WorkflowEditor'));
const TemplateGallery = lazy(() => import('./pages/TemplateGallery'));
const TemplateDetail = lazy(() => import('./pages/TemplateDetail'));
const Community = lazy(() => import('./pages/Community'));
const Profile = lazy(() => import('./pages/Profile'));
const ApiKeys = lazy(() => import('./pages/ApiKeys'));
const Models = lazy(() => import('./pages/Models'));
const ModelDocs = lazy(() => import('./pages/ModelDocs'));
const ShortDramaStudio = lazy(() => import('./pages/ShortDramaStudio'));
const Works = lazy(() => import('./pages/Works'));
const Create = lazy(() => import('./pages/Create'));
const DramaTemplateDetail = lazy(() => import('./pages/DramaTemplateDetail'));

function WorksRedirect({ type }: { type: string }) {
  const [params] = useSearchParams();
  const next = new URLSearchParams(params); next.set('type', type);
  return <Navigate to={`/works?${next}`} replace />;
}

function TemplateIndexRedirect() {
  const [params] = useSearchParams();
  const next = new URLSearchParams(params); next.set('type', 'workflow');
  return <Navigate to={`/discover?${next}`} replace />;
}

function NewWorkflowEntry() {
  const [params] = useSearchParams();
  const templateId = params.get('template');
  if (templateId) return <Navigate to={`/templates/${encodeURIComponent(templateId)}`} replace />;
  return <ProtectedRoute><WorkflowEditor /></ProtectedRoute>;
}

function App() {
  const { locale } = useI18n();
  useEffect(() => { document.documentElement.lang = locale === 'zh' ? 'zh-CN' : locale; }, [locale]);
  useEffect(() => {
    const expireSession = () => useAuthStore.getState().setUser(null);
    window.addEventListener('portal:session-expired', expireSession);
    void useAuthStore.getState().init();
    return () => window.removeEventListener('portal:session-expired', expireSession);
  }, []);

  return (
    <ConfigProvider theme={antTheme} locale={{ en: enUS, zh: zhCN, ja: jaJP }[locale]}>
      <BrowserRouter>
        <Suspense fallback={<div style={{ minHeight: '100vh' }} />}>
          <Routes>
          {/* 公开路由（无需登录） */}
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/terms" element={<Legal document="terms" />} />
          <Route path="/privacy" element={<Legal document="privacy" />} />
          <Route path="/models" element={<AppLayout><Models /></AppLayout>} />
          <Route path="/router" element={<Navigate to="/models" replace />} />
          <Route path="/models/:id" element={<AppLayout><ModelDocs /></AppLayout>} />
          <Route path="/docs" element={<AppLayout><ModelDocs /></AppLayout>} />
          <Route path="/works" element={<AppLayout><Works /></AppLayout>} />
          <Route path="/create" element={<AppLayout><Create /></AppLayout>} />
          <Route path="/short-dramas" element={<WorksRedirect type="short-drama" />} />
          <Route path="/drama-templates/:id" element={<AppLayout><DramaTemplateDetail /></AppLayout>} />
          <Route path="/short-dramas/:id" element={<ProtectedRoute><ShortDramaStudio /></ProtectedRoute>} />

          {/* 浏览页面无需登录 */}
          <Route
            path="/"
            element={
                <AppLayout>
                  <Home />
                </AppLayout>
            }
          />
          <Route
            path="/workflows"
            element={
                <AppLayout>
                  <WorksRedirect type="workflow" />
                </AppLayout>
            }
          />
          <Route
            path="/templates"
            element={<TemplateIndexRedirect />}
          />
          <Route path="/templates/:id" element={<AppLayout><TemplateDetail /></AppLayout>} />
          <Route
            path="/discover"
            element={
                <AppLayout>
                  <TemplateGallery />
                </AppLayout>
            }
          />
          <Route
            path="/community"
            element={
                <AppLayout>
                  <Community />
                </AppLayout>
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
            element={<NewWorkflowEntry />}
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

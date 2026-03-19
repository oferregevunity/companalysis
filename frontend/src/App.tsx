import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthGuard } from './components/AuthGuard';
import { Layout } from './components/Layout';
import Dashboard from './pages/Dashboard';
import GenreDetail from './pages/GenreDetail';
import Settings from './pages/Settings';
import Insights from './pages/Insights';

function App() {
  return (
    <BrowserRouter>
      <AuthGuard>
        <Layout>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/genre/:genreId" element={<GenreDetail />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/insights" element={<Insights />} />
          </Routes>
        </Layout>
      </AuthGuard>
    </BrowserRouter>
  );
}

export default App;

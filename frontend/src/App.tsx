import { Routes, Route } from 'react-router-dom'

function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
    </Routes>
  )
}

function HomePage() {
  return (
    <div style={{ padding: 24 }}>
      <h1>Welcome</h1>
      <p>React 18 + TypeScript + Vite + Ant Design</p>
    </div>
  )
}

export default App

import React, { useEffect, useState } from 'react';
import axios from 'axios';
import './App.css';

function App() {
  const [message, setMessage] = useState<string>('Загружаем ответ');
  const [error, setError] = useState<string>('');

  useEffect(() => {
    axios.get('/api/hello')
      .then(response => {
        setMessage(response.data.message);
      })
      .catch(err => {
        setError('Failed to fetch data from backend');
        console.error(err);
      });
  }, []);

  return (
    <div className="App">
      <header className="App-header">
        <h1>Веб-сервис анализа погоды</h1>
        <p>Сообщение от бэкенда: {message}</p>
        {error && <p style={{ color: 'red' }}>{error}</p>}
      </header>
    </div>
  );
}

export default App;
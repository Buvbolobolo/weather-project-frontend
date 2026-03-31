import React, { useEffect, useState } from 'react';
import axios from 'axios';
import './App.css';


type CitySummary = {
  name: string;
  country: string;
  condition: string;
  temperature_c: number;
};

type ForecastItem = {
  day: string;
  condition: string;
  min_temp_c: number;
  max_temp_c: number;
  precipitation_chance: number;
};

type WeatherDetails = {
  city: string;
  country: string;
  updated_at: string;
  condition: string;
  temperature_c: number;
  feels_like_c: number;
  humidity: number;
  wind_speed: number;
  pressure_mmhg: number;  // давление в мм рт. ст.
  visibility_km: number;
  forecast: ForecastItem[];
};

type Overview = {
  title: string;
  description: string;
  cities_count: number;
  highlight: {
    city: string;
    temperature_c: number;
    condition: string;
  };
};


function App() {
  const [cities, setCities] = useState<CitySummary[]>([]);
  const [selectedCity, setSelectedCity] = useState<string>('');
  const [weather, setWeather] = useState<WeatherDetails | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');

  // Загрузка списка городов и общей сводки при монтировании
  useEffect(() => {
    const loadInitialData = async () => {
      try {
        setLoading(true);
        const [citiesResponse, overviewResponse] = await Promise.all([
          axios.get<CitySummary[]>('/api/cities'),
          axios.get<Overview>('/api/overview'),
        ]);

        setCities(citiesResponse.data);
        setOverview(overviewResponse.data);

        // Выбираем первый город по умолчанию
        if (citiesResponse.data.length > 0) {
          setSelectedCity(citiesResponse.data[0].name);
        }
      } catch (requestError) {
        setError('Не удалось загрузить список городов и сводку.');
        console.error(requestError);
      } finally {
        setLoading(false);
      }
    };

    loadInitialData();
  }, []);

  // Загрузка погоды при изменении выбранного города
  useEffect(() => {
    if (!selectedCity) return;

    const loadWeather = async () => {
      try {
        setError('');
        const response = await axios.get<WeatherDetails>('/api/weather', {
          params: { city: selectedCity },
        });
        setWeather(response.data);

        // Обновляем информацию о городе в общем списке (температура, состояние)
        setCities((prevCities) =>
          prevCities.map((city) =>
            city.name === response.data.city
              ? {
                  ...city,
                  condition: response.data.condition,
                  temperature_c: response.data.temperature_c,
                }
              : city
          )
        );
      } catch (requestError) {
        setError('Не удалось загрузить данные о погоде.');
        console.error(requestError);
      }
    };

    loadWeather();
  }, [selectedCity]);

  // Форматирование температуры с плюсом/минусом и градусами
  const formatTemperature = (temperature: number): string => {
  const rounded = Math.round(temperature); //округляет значение погоды до ближайшего целого (12.6 = 13; 11.4 = 11)
  const sign = rounded > 0 ? '+' : '';
  return `${sign}${rounded}°C`;
};

  // Данные для героя: если погода загружена — берём из неё, иначе из сводки
  const heroCity = weather
    ? {
        city: weather.city,
        temperature_c: weather.temperature_c,
        condition: weather.condition,
      }
    : overview?.highlight;

  return (
    <div className="app-shell">
      <main className="page">
        {/* Hero-секция */}
        <section className="hero">
          <div className="hero__content">
            <span className="eyebrow">Weather Service</span>
            <h1>Погода</h1>
            <p>
              На данном этапе сервис показывает текущие погодные условия, ключевые метрики и
              краткий прогноз на 5 дней вперед.
            </p>
          </div>
          <div className="hero__panel">
            <p className="hero__panel-label">{overview?.title ?? 'Сводка'}</p>
            <h2>{heroCity?.city ?? 'Загрузка...'}</h2>
            <p className="hero__temperature">
              {heroCity ? formatTemperature(heroCity.temperature_c) : '--'}
            </p>
            <p className="hero__condition">{heroCity?.condition ?? ''}</p>
            <p className="hero__meta">
              Городов в сервисе: {overview?.cities_count ?? 0}
            </p>
          </div>
        </section>

        {/* Панель управления и текущая погода */}
        <section className="dashboard">
          <div className="controls-card">
            <div>
              <p className="section-label">Выбор города</p>
              <h3>Выберите локацию</h3>
            </div>

            <div className="city-grid">
              {cities.map((city) => (
                <button
                  key={city.name}
                  className={`city-chip ${
                    selectedCity === city.name ? 'city-chip--active' : ''
                  }`}
                  onClick={() => setSelectedCity(city.name)}
                  type="button"
                >
                  <span>{city.name}</span>
                  <small>
                    {formatTemperature(city.temperature_c)} · {city.condition}
                  </small>
                </button>
              ))}
            </div>
          </div>

          <div className="weather-card">
            {loading && <p className="status">Загружаем данные...</p>}
            {!loading && error && <p className="status status--error">{error}</p>}

            {!loading && weather && (
              <>
                <div className="weather-card__header">
                  <div>
                    <p className="section-label">Сейчас</p>
                    <h2>
                      {weather.city}, {weather.country}
                    </h2>
                    <p className="updated-at">Обновлено: {weather.updated_at}</p>
                  </div>

                  <div className="weather-card__hero-value">
                    {formatTemperature(weather.temperature_c)}
                  </div>
                </div>

                <p className="weather-condition">{weather.condition}</p>

                <div className="metrics-grid">
                  <article className="metric">
                    <span>Ощущается как</span>
                    <strong>{formatTemperature(weather.feels_like_c)}</strong>
                  </article>
                  <article className="metric">
                    <span>Влажность</span>
                    <strong>{weather.humidity}%</strong>
                  </article>
                  <article className="metric">
                    <span>Ветер</span>
                    <strong>{weather.wind_speed} м/с</strong>
                  </article>
                  <article className="metric">
                    <span>Давление</span>
                    <strong>{weather.pressure_mmhg} мм рт. ст.</strong>
                  </article>
                  <article className="metric">
                    <span>Видимость</span>
                    <strong>{weather.visibility_km} км</strong>
                  </article>
                </div>
              </>
            )}
          </div>
        </section>

        {/* Прогноз на ближайшие дни */}
        <section className="forecast-card">
          <div className="forecast-card__header">
            <div>
              <p className="section-label">Прогноз</p>
              <h3>На ближайшие 5 дней</h3>
            </div>
            <p>{overview?.description}</p>
          </div>

          <div className="forecast-grid">
            {weather?.forecast.map((day) => (
              <article className="forecast-item" key={day.day}>
                <p className="forecast-item__day">{day.day}</p>
                <strong>{day.condition}</strong>
                <p>
                  {formatTemperature(day.min_temp_c)} / {formatTemperature(day.max_temp_c)}
                </p>
                <span>Осадки: {day.precipitation_chance}%</span>
              </article>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
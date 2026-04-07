import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import L from 'leaflet';
import {
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import './App.css';

delete (L.Icon.Default.prototype as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

type CitySummary = {
  name: string;
  country: string;
  condition: string;
  temperature_c: number;
  latitude: number;
  longitude: number;
};

type ForecastItem = {
  day: string;
  condition: string;
  min_temp_c: number;
  max_temp_c: number;
  precipitation_chance: number;
};

type HourlyForecastItem = {
  time: string;
  condition: string;
  temperature_c: number;
  precipitation_chance: number;
};

type WeatherDetails = {
  city: string;
  country: string;
  latitude: number;
  longitude: number;
  updated_at: string;
  condition: string;
  temperature_c: number;
  feels_like_c: number;
  humidity: number;
  wind_speed: number;
  pressure_mmhg: number;
  visibility_km: number;
  forecast: ForecastItem[];
  hourly_forecast: HourlyForecastItem[];
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

type SelectionMode = 'city' | 'coordinates';

type CoordinatePoint = {
  latitude: number;
  longitude: number;
};

type FavoritePoint = {
  id: string;
  label: string;
  country: string;
  latitude: number;
  longitude: number;
};

const buildPointId = (latitude: number, longitude: number): string =>
  `${latitude.toFixed(4)}_${longitude.toFixed(4)}`;

const normalizeFavorites = (value: unknown): FavoritePoint[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const uniqueFavorites = new Map<string, FavoritePoint>();

  value.forEach((item) => {
    if (!item || typeof item !== 'object') {
      return;
    }

    const candidate = item as Partial<FavoritePoint>;
    if (typeof candidate.latitude !== 'number' || typeof candidate.longitude !== 'number') {
      return;
    }

    const normalizedId = buildPointId(candidate.latitude, candidate.longitude);
    if (uniqueFavorites.has(normalizedId)) {
      return;
    }

    uniqueFavorites.set(normalizedId, {
      id: normalizedId,
      label: typeof candidate.label === 'string' ? candidate.label : 'Точка',
      country: typeof candidate.country === 'string' ? candidate.country : '',
      latitude: candidate.latitude,
      longitude: candidate.longitude,
    });
  });

  return Array.from(uniqueFavorites.values());
};

const loadFavoritesFromStorage = (): FavoritePoint[] => {
  if (typeof window === 'undefined') {
    return [];
  }

  const rawFavorites = window.localStorage.getItem(FAVORITES_STORAGE_KEY);
  if (!rawFavorites) {
    return [];
  }

  try {
    return normalizeFavorites(JSON.parse(rawFavorites));
  } catch (storageError) {
    console.error(storageError);
    return [];
  }
};

const loadThemeFromStorage = (): 'light' | 'dark' => {
  if (typeof window === 'undefined') {
    return 'light';
  }

  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  return storedTheme === 'dark' ? 'dark' : 'light';
};

const FAVORITES_STORAGE_KEY = 'weather-favorites';
const THEME_STORAGE_KEY = 'weather-theme';
const DEFAULT_CENTER: CoordinatePoint = {
  latitude: 55.7558,
  longitude: 37.6176,
};
const BARNAUL_CITY_NAME = 'Барнаул';

const RAIN_LAYER_URL =
  'https://tilecache.rainviewer.com/v2/radar/nowcast_0/256/{z}/{x}/{y}/6/1_1.png';

function MapClickHandler({
  onSelect,
}: {
  onSelect: (point: CoordinatePoint) => void;
}) {
  useMapEvents({
    click(event) {
      onSelect({
        latitude: event.latlng.lat,
        longitude: event.latlng.lng,
      });
    },
  });

  return null;
}

function RecenterMap({ center }: { center: [number, number] }) {
  const map = useMap();

  useEffect(() => {
    map.setView(center, Math.max(map.getZoom(), 5));
  }, [center, map]);

  return null;
}

function App() {
  const [cities, setCities] = useState<CitySummary[]>([]);
  const [selectedCity, setSelectedCity] = useState<string>('');
  const [selectionMode, setSelectionMode] = useState<SelectionMode>('city');
  const [selectedPoint, setSelectedPoint] = useState<CoordinatePoint | null>(null);
  const [weather, setWeather] = useState<WeatherDetails | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [favorites, setFavorites] = useState<FavoritePoint[]>(loadFavoritesFromStorage);
  const [loading, setLoading] = useState<boolean>(true);
  const [weatherLoading, setWeatherLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [theme, setTheme] = useState<'light' | 'dark'>(loadThemeFromStorage);
  const [citySearchQuery, setCitySearchQuery] = useState<string>('');
  const heroSectionRef = useRef<HTMLElement | null>(null);
  const hourlySectionRef = useRef<HTMLElement | null>(null);
  const mapSectionRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const normalizedFavorites = normalizeFavorites(favorites);
    window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(normalizedFavorites));
  }, [favorites]);

  useEffect(() => {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

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

        setSelectedCity('');
        setSelectedPoint(null);
      } catch (requestError) {
        setError('Не удалось загрузить список городов и сводку.');
        console.error(requestError);
      } finally {
        setLoading(false);
      }
    };

    loadInitialData();
  }, []);

  useEffect(() => {
    if (!selectedCity || selectionMode !== 'city') {
      return;
    }

    const loadWeatherByCity = async () => {
      try {
        setError('');
        setWeatherLoading(true);
        const response = await axios.get<WeatherDetails>('/api/weather', {
          params: { city: selectedCity },
        });
        setWeather(response.data);
        setSelectedPoint({
          latitude: response.data.latitude,
          longitude: response.data.longitude,
        });
        setCities((currentCities) =>
          currentCities.map((city) =>
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
      } finally {
        setWeatherLoading(false);
      }
    };

    loadWeatherByCity();
  }, [selectedCity, selectionMode]);

  useEffect(() => {
    if (!selectedPoint || selectionMode !== 'coordinates') {
      return;
    }

    const loadWeatherByCoordinates = async () => {
      try {
        setError('');
        setWeatherLoading(true);
        const response = await axios.get<WeatherDetails>('/api/weather/by-coordinates', {
          params: {
            latitude: selectedPoint.latitude,
            longitude: selectedPoint.longitude,
          },
        });
        setWeather(response.data);
      } catch (requestError) {
        setError('Не удалось загрузить прогноз для выбранной точки.');
        console.error(requestError);
      } finally {
        setWeatherLoading(false);
      }
    };

    loadWeatherByCoordinates();
  }, [selectedPoint, selectionMode]);

  const heroCity = weather
    ? {
        city: weather.city,
        temperature_c: weather.temperature_c,
        condition: weather.condition,
      }
    : null;

  const mapCenter = useMemo<[number, number]>(() => {
    if (selectedPoint) {
      return [selectedPoint.latitude, selectedPoint.longitude];
    }

    return [DEFAULT_CENTER.latitude, DEFAULT_CENTER.longitude];
  }, [selectedPoint]);

  const isCurrentFavorite = useMemo(() => {
    if (!weather) {
      return false;
    }

    const currentPointId = buildPointId(weather.latitude, weather.longitude);
    return favorites.some((favorite) => favorite.id === currentPointId);
  }, [favorites, weather]);

  const selectableCities = useMemo(
    () => cities.filter((city) => city.name !== BARNAUL_CITY_NAME),
    [cities]
  );

  const formatTemperature = (temperature: number) => {
    const roundedTemperature = Math.ceil(temperature);
    const sign = roundedTemperature > 0 ? '+' : '';

    return `${sign}${roundedTemperature}\u00B0C`;
  };

  const handleCitySelect = (city: CitySummary) => {
    setSelectionMode('city');
    setSelectedCity(city.name);
    setCitySearchQuery(city.name);
    setSelectedPoint({
      latitude: city.latitude,
      longitude: city.longitude,
    });
  };

  const handleMapSelect = (point: CoordinatePoint) => {
    setSelectionMode('coordinates');
    setSelectedPoint(point);
  };

  const handleAddFavorite = () => {
    if (!weather || isCurrentFavorite) {
      return;
    }

    const favoriteId = buildPointId(weather.latitude, weather.longitude);

    setFavorites((currentFavorites) => {
      if (currentFavorites.some((favorite) => favorite.id === favoriteId)) {
        return currentFavorites;
      }

      return [
        {
          id: favoriteId,
          label: weather.city,
          country: weather.country,
          latitude: weather.latitude,
          longitude: weather.longitude,
        },
        ...currentFavorites,
      ];
    });
  };

  const handleFavoriteSelect = (favorite: FavoritePoint) => {
    setSelectionMode('coordinates');
    setSelectedPoint({
      latitude: favorite.latitude,
      longitude: favorite.longitude,
    });
  };

  const handleFavoriteRemove = (favoriteId: string) => {
    setFavorites((currentFavorites) =>
      currentFavorites.filter((favorite) => favorite.id !== favoriteId)
    );
  };

  const handleThemeToggle = () => {
    setTheme((currentTheme) => (currentTheme === 'light' ? 'dark' : 'light'));
  };

  const handleCitySearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedCity = citySearchQuery.trim();

    if (!normalizedCity) {
      setError('Ошибка');
      return;
    }

    setError('');
    setSelectionMode('city');
    setSelectedCity(normalizedCity);
  };

  const handleScrollToMap = () => {
    mapSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleScrollToHourly = () => {
    hourlySectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleScrollToTop = () => {
    heroSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className={`app-shell app-shell--${theme}`}>
      <main className="page">
        <div className="page-toolbar">
          <button className="theme-toggle" onClick={handleThemeToggle} type="button">
            {theme === 'light' ? 'Тёмная тема' : 'Светлая тема'}
          </button>
        </div>

        <section className="hero hero--centered" ref={heroSectionRef}>
          <div className="hero__panel">
            <p className="hero__panel-label">{overview?.title ?? 'Сводка'}</p>
            <h2>{heroCity?.city ?? 'Выберите город на карте или в Избранном'}</h2>
            <p className="hero__temperature">
              {heroCity ? formatTemperature(heroCity.temperature_c) : '--'}
            </p>
            <p className="hero__meta">
              Ощущается как: {weather ? formatTemperature(weather.feels_like_c) : '--'}
            </p>
            <p className="hero__condition">{heroCity?.condition ?? ''}</p>
            <button className="hero__nav-button" onClick={handleScrollToHourly} type="button">
              Перейти к прогнозам
            </button>
            <button className="hero__map-button" onClick={handleScrollToMap} type="button">
              Перейти к карте
            </button>
          </div>
        </section>

        <section className="dashboard">
          <div className="controls-card">
            <div>
              <p className="section-label">Выбор города</p>
              <h3>Быстрый переход к готовым локациям</h3>
            </div>

            <div className="city-grid">
              {selectableCities.map((city) => (
                <button
                  key={city.name}
                  className={`city-chip ${
                    selectionMode === 'city' && selectedCity === city.name
                      ? 'city-chip--active'
                      : ''
                  }`}
                  onClick={() => handleCitySelect(city)}
                  type="button"
                >
                  <span>{city.name}</span>
                  <small>
                    {formatTemperature(city.temperature_c)} · {city.condition}
                  </small>
                </button>
              ))}
            </div>

            <div className="favorites-panel">
              <div className="favorites-panel__header">
                <p className="section-label">Избранное</p>
              </div>

              <div className="favorites-list">
                {favorites.length === 0 && (
                  <p className="favorites-empty">Пока нет сохраненных точек.</p>
                )}

                {favorites.map((favorite) => (
                  <div className="favorite-item" key={favorite.id}>
                    <button
                      className="favorite-item__main"
                      onClick={() => handleFavoriteSelect(favorite)}
                      type="button"
                    >
                      <strong>{favorite.label}</strong>
                      <span>{favorite.country}</span>
                      <small>
                        {favorite.latitude.toFixed(4)}, {favorite.longitude.toFixed(4)}
                      </small>
                    </button>
                    <button
                      className="favorite-item__remove"
                      onClick={() => handleFavoriteRemove(favorite.id)}
                      type="button"
                    >
                      Удалить
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="weather-card">
            {(loading || weatherLoading) && <p className="status">Загружаем данные...</p>}
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

        <section className="hourly-card" ref={hourlySectionRef}>
          <div className="forecast-card__header">
            <div>
              <p className="section-label">Почасовой прогноз</p>
              <h3>Погода на 24 часа</h3>
            </div>
            <p>Для выбранной точки с шагом в 1 час.</p>
          </div>

          <div className="hourly-scroll" role="region" aria-label="Почасовой прогноз на 24 часа">
            <div className="hourly-grid">
              {weather?.hourly_forecast.map((hour) => (
                <article className="hourly-item" key={`${hour.time}-${hour.condition}`}>
                  <p className="hourly-item__time">{hour.time}</p>
                  <strong>{hour.condition}</strong>
                  <p className="hourly-item__temp">{formatTemperature(hour.temperature_c)}</p>
                  <p className="hourly-item__precipitation">
                    Вероятность осадков: {hour.precipitation_chance}%
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="forecast-card">
          <div className="forecast-card__header">
            <div>
              <p className="section-label">Прогноз</p>
              <h3>Ближайшие 7 дней</h3>
            </div>
            <p>{overview?.description}</p>
          </div>

          <div className="forecast-scroll" role="region" aria-label="Прогноз на ближайшие дни">
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
          </div>
        </section>

        <section className="map-card" ref={mapSectionRef}>
          <div className="map-card__header">
            <div>
              <p className="section-label">Карта</p>
              <h3>Нажмите на карту для прогноза по координатам</h3>
            </div>
            <p>Базовая карта OpenStreetMap</p>
          </div>

          <div className="map-card__body">
            <div className="map-frame">
              <MapContainer
                attributionControl={false}
                center={mapCenter}
                zoom={5}
                maxZoom={10}
                className="leaflet-map"
                scrollWheelZoom
              >
                <RecenterMap center={mapCenter} />
                <TileLayer
                  maxZoom={19}
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <TileLayer
                  maxNativeZoom={10}
                  maxZoom={10}
                  opacity={0.55}
                  url={RAIN_LAYER_URL}
                />
                {selectedPoint && (
                  <Marker position={[selectedPoint.latitude, selectedPoint.longitude]}>
                    <Popup>
                      <div className="popup-weather">
                        <strong>{weather?.city ?? 'Выбранная точка'}</strong>
                        <span>
                          {weather ? formatTemperature(weather.temperature_c) : 'Загрузка...'}
                        </span>
                        <span>{weather?.condition ?? 'Получаем данные о погоде'}</span>
                      </div>
                    </Popup>
                  </Marker>
                )}
                <MapClickHandler onSelect={handleMapSelect} />
              </MapContainer>
              <div className="custom-attribution">
                Источники: OpenStreetMap contributors, RainViewer
              </div>
            </div>

            <div className="map-card__info">
              <div className="map-card__info-panel">
                <span>Избранное</span>
                <strong>
                  <button
                    className="favorite-action"
                    disabled={!weather || isCurrentFavorite}
                    onClick={handleAddFavorite}
                    type="button"
                  >
                    {isCurrentFavorite ? 'Уже в избранном' : 'Добавить в избранное'}
                  </button>
                </strong>
              </div>
              <div className="map-card__info-panel">
                <span>Определенный город</span>
                <strong>{weather ? `${weather.city}, ${weather.country}` : 'Загрузка...'}</strong>
              </div>
              <form className="map-city-search" onSubmit={handleCitySearch}>
                <input
                  className="map-city-search__input"
                  onChange={(event) => setCitySearchQuery(event.target.value)}
                  placeholder="Введите название города"
                  type="text"
                  value={citySearchQuery}
                />
                <button className="map-city-search__button" type="submit">
                  Показать
                </button>
              </form>
            </div>
          </div>
          <button className="map__top-button" onClick={handleScrollToTop} type="button">
            Перейти в начало
          </button>
        </section>

      </main>
    </div>
  );
}

export default App;








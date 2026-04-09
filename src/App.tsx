import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  wind_speed_m_s?: number;
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

type TomorrowAlert = {
  id: string;
  label: string;
  country: string;
  latitude: number;
  longitude: number;
  last_notified_on: string | null;
};

type PersistedSelection = {
  selectionMode: SelectionMode;
  selectedCity: string;
  selectedPoint: CoordinatePoint | null;
  citySearchQuery: string;
};

const buildPointId = (latitude: number, longitude: number): string =>
  `${latitude.toFixed(4)}_${longitude.toFixed(4)}`;

const FAVORITES_STORAGE_KEY = 'weather-favorites';
const THEME_STORAGE_KEY = 'weather-theme';
const SELECTION_STORAGE_KEY = 'weather-last-selection';
const TOMORROW_ALERTS_STORAGE_KEY = 'weather-tomorrow-alerts';

const getCurrentDateKey = (): string => {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
};

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

const normalizeTomorrowAlerts = (value: unknown): TomorrowAlert[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const uniqueAlerts = new Map<string, TomorrowAlert>();

  value.forEach((item) => {
    if (!item || typeof item !== 'object') {
      return;
    }

    const candidate = item as Partial<TomorrowAlert>;
    if (typeof candidate.latitude !== 'number' || typeof candidate.longitude !== 'number') {
      return;
    }

    const normalizedId = buildPointId(candidate.latitude, candidate.longitude);
    if (uniqueAlerts.has(normalizedId)) {
      return;
    }

    uniqueAlerts.set(normalizedId, {
      id: normalizedId,
      label: typeof candidate.label === 'string' ? candidate.label : 'Точка',
      country: typeof candidate.country === 'string' ? candidate.country : '',
      latitude: candidate.latitude,
      longitude: candidate.longitude,
      last_notified_on:
        typeof candidate.last_notified_on === 'string' ? candidate.last_notified_on : null,
    });
  });

  return Array.from(uniqueAlerts.values());
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

const loadTomorrowAlertsFromStorage = (): TomorrowAlert[] => {
  if (typeof window === 'undefined') {
    return [];
  }

  const rawAlerts = window.localStorage.getItem(TOMORROW_ALERTS_STORAGE_KEY);
  if (!rawAlerts) {
    return [];
  }

  try {
    return normalizeTomorrowAlerts(JSON.parse(rawAlerts));
  } catch (storageError) {
    console.error(storageError);
    return [];
  }
};

const persistTomorrowAlerts = (alerts: TomorrowAlert[]) => {
  if (typeof window === 'undefined') {
    return;
  }

  const normalizedAlerts = normalizeTomorrowAlerts(alerts);
  window.localStorage.setItem(TOMORROW_ALERTS_STORAGE_KEY, JSON.stringify(normalizedAlerts));
};

const loadSelectionFromStorage = (): PersistedSelection => {
  const fallback: PersistedSelection = {
    selectionMode: 'city',
    selectedCity: '',
    selectedPoint: null,
    citySearchQuery: '',
  };

  if (typeof window === 'undefined') {
    return fallback;
  }

  const rawSelection = window.localStorage.getItem(SELECTION_STORAGE_KEY);
  if (!rawSelection) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(rawSelection) as Partial<PersistedSelection>;
    const selectionMode: SelectionMode =
      parsed.selectionMode === 'coordinates' ? 'coordinates' : 'city';
    const selectedCity = typeof parsed.selectedCity === 'string' ? parsed.selectedCity : '';
    const citySearchQuery =
      typeof parsed.citySearchQuery === 'string' ? parsed.citySearchQuery : selectedCity;
    const selectedPoint =
      parsed.selectedPoint &&
      typeof parsed.selectedPoint === 'object' &&
      typeof parsed.selectedPoint.latitude === 'number' &&
      typeof parsed.selectedPoint.longitude === 'number'
        ? {
            latitude: parsed.selectedPoint.latitude,
            longitude: parsed.selectedPoint.longitude,
          }
        : null;

    return {
      selectionMode,
      selectedCity,
      selectedPoint,
      citySearchQuery,
    };
  } catch (storageError) {
    console.error(storageError);
    return fallback;
  }
};

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
  const persistedSelection = useMemo(loadSelectionFromStorage, []);
  const [cities, setCities] = useState<CitySummary[]>([]);
  const [selectedCity, setSelectedCity] = useState<string>(persistedSelection.selectedCity);
  const [selectionMode, setSelectionMode] = useState<SelectionMode>(
    persistedSelection.selectionMode
  );
  const [selectedPoint, setSelectedPoint] = useState<CoordinatePoint | null>(
    persistedSelection.selectedPoint
  );
  const [weather, setWeather] = useState<WeatherDetails | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [favorites, setFavorites] = useState<FavoritePoint[]>(loadFavoritesFromStorage);
  const [tomorrowAlerts, setTomorrowAlerts] = useState<TomorrowAlert[]>(
    loadTomorrowAlertsFromStorage
  );
  const [loading, setLoading] = useState<boolean>(true);
  const [weatherLoading, setWeatherLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [theme, setTheme] = useState<'light' | 'dark'>(loadThemeFromStorage);
  const [citySearchQuery, setCitySearchQuery] = useState<string>(
    persistedSelection.citySearchQuery
  );
  const [toastLines, setToastLines] = useState<string[]>([]);
  const [browserNotificationPermission, setBrowserNotificationPermission] = useState<
    NotificationPermission | 'unsupported'
  >(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      return 'unsupported';
    }

    return window.Notification.permission;
  });
  const heroSectionRef = useRef<HTMLElement | null>(null);
  const hourlySectionRef = useRef<HTMLElement | null>(null);
  const mapSectionRef = useRef<HTMLElement | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const isBrowserNotificationSupported = browserNotificationPermission !== 'unsupported';

  useEffect(() => {
    const normalizedFavorites = normalizeFavorites(favorites);
    window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(normalizedFavorites));
  }, [favorites]);

  useEffect(() => {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    if (!selectedCity && !selectedPoint && !citySearchQuery) {
      window.localStorage.removeItem(SELECTION_STORAGE_KEY);
      return;
    }

    const selectionPayload: PersistedSelection = {
      selectionMode,
      selectedCity,
      selectedPoint,
      citySearchQuery,
    };
    window.localStorage.setItem(SELECTION_STORAGE_KEY, JSON.stringify(selectionPayload));
  }, [citySearchQuery, selectedCity, selectedPoint, selectionMode]);

  useEffect(() => {
    persistTomorrowAlerts(tomorrowAlerts);
  }, [tomorrowAlerts]);

  useEffect(() => {
    setTomorrowAlerts((currentAlerts) => {
      const favoriteById = new Map(favorites.map((favorite) => [favorite.id, favorite]));
      let hasChanges = false;

      const syncedAlerts: TomorrowAlert[] = [];
      currentAlerts.forEach((alertItem) => {
        const favorite = favoriteById.get(alertItem.id);
        if (!favorite) {
          hasChanges = true;
          return;
        }

        if (
          alertItem.label !== favorite.label ||
          alertItem.country !== favorite.country ||
          alertItem.latitude !== favorite.latitude ||
          alertItem.longitude !== favorite.longitude
        ) {
          hasChanges = true;
          syncedAlerts.push({
            ...alertItem,
            label: favorite.label,
            country: favorite.country,
            latitude: favorite.latitude,
            longitude: favorite.longitude,
          });
          return;
        }

        syncedAlerts.push(alertItem);
      });

      return hasChanges ? syncedAlerts : currentAlerts;
    });
  }, [favorites]);

  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setBrowserNotificationPermission('unsupported');
      return;
    }

    const syncBrowserPermission = () => {
      setBrowserNotificationPermission(window.Notification.permission);
    };

    syncBrowserPermission();
    window.addEventListener('focus', syncBrowserPermission);
    document.addEventListener('visibilitychange', syncBrowserPermission);

    return () => {
      window.removeEventListener('focus', syncBrowserPermission);
      document.removeEventListener('visibilitychange', syncBrowserPermission);
    };
  }, []);

  const showBrowserNotification = useCallback((messages: string[]) => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      return;
    }
    if (window.Notification.permission !== 'granted') {
      return;
    }

    const tabIsBackground =
      typeof document !== 'undefined' &&
      (document.visibilityState === 'hidden' || !document.hasFocus());
    if (!tabIsBackground) {
      return;
    }

    try {
      new window.Notification(
        messages.length > 1 ? `Прогноз на завтра (${messages.length})` : 'Прогноз на завтра',
        {
          body: messages.join('\n'),
          icon: '/favicon.ico',
          tag: 'weather-tomorrow-alert',
        }
      );
    } catch (notificationError) {
      console.error(notificationError);
    }
  }, []);

  useEffect(() => {
    const formatAlertTemperature = (temperature: number) => {
      const roundedTemperature = Math.ceil(temperature);
      const sign = roundedTemperature > 0 ? '+' : '';
      return `${sign}${roundedTemperature}\u00B0C`;
    };

    let isCancelled = false;

    const checkTomorrowAlertsOnStartup = async () => {
      const storedAlerts = loadTomorrowAlertsFromStorage();
      if (storedAlerts.length === 0) {
        return;
      }

      const todayKey = getCurrentDateKey();
      const favoriteIds = new Set(loadFavoritesFromStorage().map((favorite) => favorite.id));
      const nextAlerts = [...storedAlerts];
      const notificationMessages: string[] = [];

      for (let index = 0; index < nextAlerts.length; index += 1) {
        const alertItem = nextAlerts[index];
        if (!favoriteIds.has(alertItem.id) || alertItem.last_notified_on === todayKey) {
          continue;
        }

        try {
          const response = await axios.get<WeatherDetails>('/api/weather/by-coordinates', {
            params: {
              latitude: alertItem.latitude,
              longitude: alertItem.longitude,
            },
          });

          const tomorrowForecast =
            response.data.forecast.find((forecastDay) =>
              forecastDay.day.toLowerCase().includes('завтра')
            ) ?? response.data.forecast[1];
          if (!tomorrowForecast) {
            continue;
          }

          const windSpeed = Math.ceil(
            typeof tomorrowForecast.wind_speed_m_s === 'number'
              ? tomorrowForecast.wind_speed_m_s
              : response.data.wind_speed
          );

          notificationMessages.push(
            `${alertItem.label}: завтра ${tomorrowForecast.condition.toLowerCase()}. ` +
              `Днем до ${formatAlertTemperature(tomorrowForecast.max_temp_c)}, ` +
              `Ночью до ${formatAlertTemperature(tomorrowForecast.min_temp_c)}, ` +
              `Ветер ${windSpeed} м/с`
          );

          nextAlerts[index] = {
            ...alertItem,
            label: response.data.city || alertItem.label,
            country: response.data.country || alertItem.country,
            latitude: response.data.latitude,
            longitude: response.data.longitude,
            last_notified_on: todayKey,
          };
        } catch (requestError) {
          console.error(requestError);
        }
      }

      if (isCancelled) {
        return;
      }

      const normalizedNextAlerts = normalizeTomorrowAlerts(nextAlerts);
      if (JSON.stringify(normalizedNextAlerts) !== JSON.stringify(storedAlerts)) {
        persistTomorrowAlerts(normalizedNextAlerts);
        setTomorrowAlerts(normalizedNextAlerts);
      }

      if (notificationMessages.length > 0) {
        setToastLines(notificationMessages);
        showBrowserNotification(notificationMessages);
      }
    };

    checkTomorrowAlertsOnStartup();

    return () => {
      isCancelled = true;
    };
  }, [showBrowserNotification]);

  useEffect(() => {
    if (toastLines.length === 0) {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }
      return;
    }

    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }

    toastTimerRef.current = window.setTimeout(() => {
      setToastLines([]);
      toastTimerRef.current = null;
    }, 15000);

    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }
    };
  }, [toastLines]);

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

  const currentPointId = useMemo(() => {
    if (!weather) {
      return null;
    }

    return buildPointId(weather.latitude, weather.longitude);
  }, [weather]);

  const currentFavorite = useMemo(() => {
    if (!currentPointId) {
      return null;
    }

    return favorites.find((favorite) => favorite.id === currentPointId) ?? null;
  }, [currentPointId, favorites]);

  const isCurrentFavorite = currentFavorite !== null;

  const isTomorrowAlertEnabled = useMemo(() => {
    if (!currentPointId) {
      return false;
    }

    return tomorrowAlerts.some((alertItem) => alertItem.id === currentPointId);
  }, [currentPointId, tomorrowAlerts]);

  const activeAlertIds = useMemo(
    () => new Set(tomorrowAlerts.map((alertItem) => alertItem.id)),
    [tomorrowAlerts]
  );

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
    setSelectedCity('');
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
    setSelectedCity('');
    setSelectedPoint({
      latitude: favorite.latitude,
      longitude: favorite.longitude,
    });
    setCitySearchQuery(favorite.label);
  };

  const handleFavoriteRemove = (favoriteId: string) => {
    setFavorites((currentFavorites) =>
      currentFavorites.filter((favorite) => favorite.id !== favoriteId)
    );
    setTomorrowAlerts((currentAlerts) => {
      const nextAlerts = currentAlerts.filter((alertItem) => alertItem.id !== favoriteId);
      persistTomorrowAlerts(nextAlerts);
      return nextAlerts;
    });
  };

  const handleToggleTomorrowAlert = () => {
    if (!weather || !currentPointId || !isCurrentFavorite) {
      return;
    }

    setTomorrowAlerts((currentAlerts) => {
      if (currentAlerts.some((alertItem) => alertItem.id === currentPointId)) {
        const nextAlerts = currentAlerts.filter((alertItem) => alertItem.id !== currentPointId);
        persistTomorrowAlerts(nextAlerts);
        setToastLines([`Уведомление на завтра для «${weather.city}» отключено.`]);
        return nextAlerts;
      }

      const nextAlerts = [
        {
          id: currentPointId,
          label: currentFavorite?.label ?? weather.city,
          country: currentFavorite?.country ?? weather.country,
          latitude: weather.latitude,
          longitude: weather.longitude,
          last_notified_on: null,
        },
        ...currentAlerts,
      ];
      persistTomorrowAlerts(nextAlerts);
      setToastLines([`Уведомление на завтра для «${weather.city}» включено.`]);
      return nextAlerts;
    });
  };

  const handleThemeToggle = () => {
    setTheme((currentTheme) => (currentTheme === 'light' ? 'dark' : 'light'));
  };

  const handleEnableBrowserNotifications = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setBrowserNotificationPermission('unsupported');
      setToastLines(['Этот браузер не поддерживает системные уведомления.']);
      return;
    }

    if (window.Notification.permission === 'granted') {
      setBrowserNotificationPermission('granted');
      setToastLines(['Браузерные уведомления уже включены.']);
      return;
    }

    if (window.Notification.permission === 'denied') {
      setBrowserNotificationPermission('denied');
      setToastLines(['Уведомления заблокированы в браузере. Разрешите их в настройках сайта.']);
      return;
    }

    try {
      const permission = await window.Notification.requestPermission();
      setBrowserNotificationPermission(permission);

      if (permission === 'granted') {
        setToastLines([
          'Браузерные уведомления включены. Уведомления будут приходить даже на другой вкладке.',
        ]);
        return;
      }

      setToastLines(['Без разрешения браузера системные уведомления недоступны.']);
    } catch (notificationError) {
      console.error(notificationError);
      setToastLines(['Не удалось запросить разрешение на системные уведомления.']);
    }
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

  const handleCloseToast = () => {
    setToastLines([]);
  };

  return (
    <div className={`app-shell app-shell--${theme}`}>
      <main className="page">
        <div className="page-toolbar">
          <button
            className={`browser-notification-toggle browser-notification-toggle--${browserNotificationPermission}`}
            disabled={!isBrowserNotificationSupported || browserNotificationPermission === 'granted'}
            onClick={handleEnableBrowserNotifications}
            type="button"
          >
            {browserNotificationPermission === 'unsupported'
              ? 'Браузер не поддерживает уведомления'
              : browserNotificationPermission === 'granted'
                ? 'Браузерные уведомления: включены'
                : browserNotificationPermission === 'denied'
                  ? 'Уведомления браузера заблокированы'
                  : 'Включить браузерные уведомления'}
          </button>
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
            <button
              className={`hero__alert-button ${
                isTomorrowAlertEnabled ? 'hero__alert-button--off' : 'hero__alert-button--on'
              }`}
              disabled={!weather || !isCurrentFavorite}
              onClick={handleToggleTomorrowAlert}
              type="button"
            >
              {isTomorrowAlertEnabled
                ? 'Отключить уведомления на завтра'
                : 'Включить уведомления на завтра'}
            </button>
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

            <div className="controls-quick-actions">
              <form className="map-city-search controls-city-search" onSubmit={handleCitySearch}>
                <input
                  className="map-city-search__input"
                  onChange={(event) => setCitySearchQuery(event.target.value)}
                  placeholder="Введите название города"
                  type="text"
                  value={citySearchQuery}
                />
                <button className="map-city-search__button" type="submit">
                  Выбрать
                </button>
              </form>
              <button
                className="favorite-action controls-add-favorite"
                disabled={!weather || isCurrentFavorite}
                onClick={handleAddFavorite}
                type="button"
              >
                {isCurrentFavorite ? 'Уже в избранном' : 'Добавить в избранное'}
              </button>
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
                      <small className="favorite-item__alert">
                        {activeAlertIds.has(favorite.id)
                          ? 'Уведомление на завтра: включено'
                          : 'Уведомление на завтра: выключено'}
                      </small>
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

        {toastLines.length > 0 && (
          <aside className="toast-banner" role="status" aria-live="polite">
            <div className="toast-banner__header">
              <strong>Прогноз на завтра</strong>
              <button className="toast-banner__close" onClick={handleCloseToast} type="button">
                Закрыть
              </button>
            </div>
            <div className="toast-banner__body">
              {toastLines.map((line, index) => (
                <p key={`${line}-${index}`}>{line}</p>
              ))}
            </div>
          </aside>
        )}

      </main>
    </div>
  );
}

export default App;








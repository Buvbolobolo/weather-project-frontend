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


axios.defaults.baseURL = process.env.REACT_APP_API_URL || '';


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
  tomorrow_metrics: {
    precipitation_chance: number;
    humidity: number;
    wind_speed_m_s: number;
    pressure_mmhg: number;
    visibility_km: number;
  };
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

type NotificationPreferences = {
  precipitation: boolean;
  humidity: boolean;
  wind: boolean;
  pressure: boolean;
  visibility: boolean;
};

type TomorrowAlert = {
  id: string;
  label: string;
  country: string;
  latitude: number;
  longitude: number;
  last_notified_on: string | null;
  preferences: NotificationPreferences;
};

type PersistedSelection = {
  selectionMode: SelectionMode;
  selectedCity: string;
  selectedPoint: CoordinatePoint | null;
  citySearchQuery: string;
};

type PushSubscriptionPayload = {
  endpoint: string;
  expirationTime: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
};

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
};

const buildPointId = (latitude: number, longitude: number): string =>
  `${latitude.toFixed(4)}_${longitude.toFixed(4)}`;

const FAVORITES_STORAGE_KEY = 'weather-favorites';
const THEME_STORAGE_KEY = 'weather-theme';
const SELECTION_STORAGE_KEY = 'weather-last-selection';
const TOMORROW_ALERTS_STORAGE_KEY = 'weather-tomorrow-alerts';
const PUSH_SUBSCRIPTION_STORAGE_KEY = 'weather-push-subscription';
const NOTIFICATION_PREFERENCES_STORAGE_KEY = 'weather-alert-preferences';

const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  precipitation: true,
  humidity: true,
  wind: true,
  pressure: true,
  visibility: true,
};

const NOTIFICATION_PREFERENCE_OPTIONS: Array<{
  key: keyof NotificationPreferences;
  label: string;
}> = [
  { key: 'precipitation', label: 'Вероятность осадков' },
  { key: 'humidity', label: 'Влажность' },
  { key: 'wind', label: 'Ветер' },
  { key: 'pressure', label: 'Давление' },
  { key: 'visibility', label: 'Видимость' },
];

const getCurrentDateKey = (): string => {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
};

const normalizeNotificationPreferences = (value: unknown): NotificationPreferences => {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_NOTIFICATION_PREFERENCES };
  }

  const candidate = value as Partial<NotificationPreferences>;
  return {
    precipitation:
      typeof candidate.precipitation === 'boolean'
        ? candidate.precipitation
        : typeof (candidate as { feels_like?: unknown }).feels_like === 'boolean'
          ? Boolean((candidate as { feels_like: boolean }).feels_like)
          : DEFAULT_NOTIFICATION_PREFERENCES.precipitation,
    humidity:
      typeof candidate.humidity === 'boolean'
        ? candidate.humidity
        : DEFAULT_NOTIFICATION_PREFERENCES.humidity,
    wind:
      typeof candidate.wind === 'boolean' ? candidate.wind : DEFAULT_NOTIFICATION_PREFERENCES.wind,
    pressure:
      typeof candidate.pressure === 'boolean'
        ? candidate.pressure
        : DEFAULT_NOTIFICATION_PREFERENCES.pressure,
    visibility:
      typeof candidate.visibility === 'boolean'
        ? candidate.visibility
        : DEFAULT_NOTIFICATION_PREFERENCES.visibility,
  };
};

const formatSignedTemperature = (temperature: number): string => {
  const roundedTemperature = Math.ceil(temperature);
  const sign = roundedTemperature > 0 ? '+' : '';
  return `${sign}${roundedTemperature}\u00B0C`;
};

const buildTomorrowNotificationText = (
  alertLabel: string,
  weatherDetails: WeatherDetails,
  preferences: NotificationPreferences
): string | null => {
  const tomorrowForecast =
    weatherDetails.forecast.find((forecastDay) => forecastDay.day.toLowerCase().includes('завтра')) ??
    weatherDetails.forecast[1];
  if (!tomorrowForecast) {
    return null;
  }

  const details: string[] = [];
  if (preferences.precipitation) {
    details.push(`Вероятность осадков ${weatherDetails.tomorrow_metrics?.precipitation_chance ?? 0}%`);
  }
  if (preferences.humidity) {
    details.push(`Влажность ${weatherDetails.tomorrow_metrics?.humidity ?? 0}%`);
  }
  if (preferences.wind) {
    const windSpeed = Math.ceil(
      weatherDetails.tomorrow_metrics?.wind_speed_m_s ??
        (typeof tomorrowForecast.wind_speed_m_s === 'number'
          ? tomorrowForecast.wind_speed_m_s
          : weatherDetails.wind_speed)
    );
    details.push(`Ветер ${windSpeed} м/с`);
  }
  if (preferences.pressure) {
    details.push(`Давление ${weatherDetails.tomorrow_metrics?.pressure_mmhg ?? 0} мм рт. ст.`);
  }
  if (preferences.visibility) {
    details.push(`Видимость ${weatherDetails.tomorrow_metrics?.visibility_km ?? 0} км`);
  }

  const baseText =
    `${alertLabel}: завтра ${tomorrowForecast.condition.toLowerCase()}. ` +
    `Днем до ${formatSignedTemperature(tomorrowForecast.max_temp_c)}, ` +
    `Ночью до ${formatSignedTemperature(tomorrowForecast.min_temp_c)}`;

  return details.length > 0 ? `${baseText}. ${details.join(', ')}` : baseText;
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
      preferences: normalizeNotificationPreferences(candidate.preferences),
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

const loadNotificationPreferencesFromStorage = (): NotificationPreferences => {
  if (typeof window === 'undefined') {
    return { ...DEFAULT_NOTIFICATION_PREFERENCES };
  }

  const rawPreferences = window.localStorage.getItem(NOTIFICATION_PREFERENCES_STORAGE_KEY);
  if (!rawPreferences) {
    return { ...DEFAULT_NOTIFICATION_PREFERENCES };
  }

  try {
    return normalizeNotificationPreferences(JSON.parse(rawPreferences));
  } catch (storageError) {
    console.error(storageError);
    return { ...DEFAULT_NOTIFICATION_PREFERENCES };
  }
};

const persistNotificationPreferences = (preferences: NotificationPreferences) => {
  if (typeof window === 'undefined') {
    return;
  }

  const normalizedPreferences = normalizeNotificationPreferences(preferences);
  window.localStorage.setItem(
    NOTIFICATION_PREFERENCES_STORAGE_KEY,
    JSON.stringify(normalizedPreferences)
  );
};

const persistTomorrowAlerts = (alerts: TomorrowAlert[]) => {
  if (typeof window === 'undefined') {
    return;
  }

  const normalizedAlerts = normalizeTomorrowAlerts(alerts);
  window.localStorage.setItem(TOMORROW_ALERTS_STORAGE_KEY, JSON.stringify(normalizedAlerts));
};

const loadPushSubscriptionFromStorage = (): PushSubscriptionPayload | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  const rawValue = window.localStorage.getItem(PUSH_SUBSCRIPTION_STORAGE_KEY);
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<PushSubscriptionPayload>;
    if (
      typeof parsed.endpoint !== 'string' ||
      !parsed.keys ||
      typeof parsed.keys.p256dh !== 'string' ||
      typeof parsed.keys.auth !== 'string'
    ) {
      return null;
    }

    return {
      endpoint: parsed.endpoint,
      expirationTime:
        typeof parsed.expirationTime === 'number' ? parsed.expirationTime : null,
      keys: {
        p256dh: parsed.keys.p256dh,
        auth: parsed.keys.auth,
      },
    };
  } catch (storageError) {
    console.error(storageError);
    return null;
  }
};

const persistPushSubscription = (value: PushSubscriptionPayload | null) => {
  if (typeof window === 'undefined') {
    return;
  }

  if (!value) {
    window.localStorage.removeItem(PUSH_SUBSCRIPTION_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(PUSH_SUBSCRIPTION_STORAGE_KEY, JSON.stringify(value));
};

const urlBase64ToUint8Array = (base64String: string): Uint8Array => {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let index = 0; index < rawData.length; index += 1) {
    outputArray[index] = rawData.charCodeAt(index);
  }
  return outputArray;
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
  const [notificationPreferences, setNotificationPreferences] = useState<NotificationPreferences>(
    loadNotificationPreferencesFromStorage
  );
  const [toastLines, setToastLines] = useState<string[]>([]);
  const [pushSubscription, setPushSubscription] = useState<PushSubscriptionPayload | null>(
    loadPushSubscriptionFromStorage
  );
  const [installPromptEvent, setInstallPromptEvent] = useState<BeforeInstallPromptEvent | null>(
    null
  );
  const [isStandaloneApp, setIsStandaloneApp] = useState<boolean>(() => {
    if (typeof window === 'undefined') {
      return false;
    }

    const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone;
    return window.matchMedia('(display-mode: standalone)').matches || iosStandalone === true;
  });
  const previousAlertIdsRef = useRef<string[]>(tomorrowAlerts.map((alertItem) => alertItem.id));
  const pushRegistrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const pushPublicKeyRef = useRef<string | null>(null);
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
    persistNotificationPreferences(notificationPreferences);
  }, [notificationPreferences]);

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
    persistPushSubscription(pushSubscription);
  }, [pushSubscription]);

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }

    const initializeServiceWorker = async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js');
        pushRegistrationRef.current = registration;
        const subscription = await registration.pushManager.getSubscription();
        if (!subscription) {
          return;
        }

        const subscriptionJson = subscription.toJSON();
        if (
          !subscriptionJson.endpoint ||
          !subscriptionJson.keys?.p256dh ||
          !subscriptionJson.keys?.auth
        ) {
          return;
        }

        setPushSubscription({
          endpoint: subscriptionJson.endpoint,
          expirationTime:
            typeof subscriptionJson.expirationTime === 'number'
              ? subscriptionJson.expirationTime
              : null,
          keys: {
            p256dh: subscriptionJson.keys.p256dh,
            auth: subscriptionJson.keys.auth,
          },
        });
      } catch (registrationError) {
        console.error(registrationError);
      }
    };

    void initializeServiceWorker();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const mediaQuery = window.matchMedia('(display-mode: standalone)');
    const syncStandaloneState = () => {
      const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone;
      setIsStandaloneApp(mediaQuery.matches || iosStandalone === true);
    };

    const handleBeforeInstallPrompt = (event: Event) => {
      const installEvent = event as BeforeInstallPromptEvent;
      installEvent.preventDefault();
      setInstallPromptEvent(installEvent);
    };

    const handleAppInstalled = () => {
      setIsStandaloneApp(true);
      setInstallPromptEvent(null);
      setToastLines(['Приложение установлено. Теперь его можно открывать как отдельное приложение.']);
    };

    syncStandaloneState();
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt as EventListener);
    window.addEventListener('appinstalled', handleAppInstalled);

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', syncStandaloneState);
    } else {
      mediaQuery.addListener(syncStandaloneState);
    }

    return () => {
      window.removeEventListener(
        'beforeinstallprompt',
        handleBeforeInstallPrompt as EventListener
      );
      window.removeEventListener('appinstalled', handleAppInstalled);

      if (typeof mediaQuery.removeEventListener === 'function') {
        mediaQuery.removeEventListener('change', syncStandaloneState);
      } else {
        mediaQuery.removeListener(syncStandaloneState);
      }
    };
  }, []);

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

  const registerPushServiceWorker = useCallback(async () => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      throw new Error('Service Worker is not supported');
    }

    if (pushRegistrationRef.current) {
      return pushRegistrationRef.current;
    }

    const registration = await navigator.serviceWorker.register('/sw.js');
    pushRegistrationRef.current = registration;
    return registration;
  }, []);

  const getVapidPublicKey = useCallback(async (): Promise<string> => {
    if (pushPublicKeyRef.current) {
      return pushPublicKeyRef.current;
    }

    const response = await axios.get<{
      enabled: boolean;
      reason: string | null;
      public_key: string | null;
    }>('/api/push/public-key');

    if (!response.data.enabled || !response.data.public_key) {
      throw new Error(response.data.reason || 'Push is disabled on backend');
    }

    pushPublicKeyRef.current = response.data.public_key;
    return response.data.public_key;
  }, []);

  const ensurePushSubscription = useCallback(async (): Promise<PushSubscriptionPayload> => {
    if (typeof window === 'undefined' || !('PushManager' in window)) {
      throw new Error('Push API is not supported');
    }
    if (window.Notification.permission !== 'granted') {
      throw new Error('Browser notifications permission is not granted');
    }

    const registration = await registerPushServiceWorker();
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      const vapidPublicKey = await getVapidPublicKey();
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });
    }

    const subscriptionJson = subscription.toJSON();
    if (
      !subscriptionJson.endpoint ||
      !subscriptionJson.keys?.p256dh ||
      !subscriptionJson.keys?.auth
    ) {
      throw new Error('Invalid push subscription');
    }

    const payload: PushSubscriptionPayload = {
      endpoint: subscriptionJson.endpoint,
      expirationTime:
        typeof subscriptionJson.expirationTime === 'number'
          ? subscriptionJson.expirationTime
          : null,
      keys: {
        p256dh: subscriptionJson.keys.p256dh,
        auth: subscriptionJson.keys.auth,
      },
    };
    setPushSubscription(payload);
    return payload;
  }, [getVapidPublicKey, registerPushServiceWorker]);

  const registerPushAlert = useCallback(
    async (
      alert: TomorrowAlert,
      subscriptionPayload: PushSubscriptionPayload,
      options?: { resetLastNotifiedOn?: boolean }
    ) => {
      await axios.post('/api/push/register-alert', {
        subscription: subscriptionPayload,
        alert: {
          id: alert.id,
          label: alert.label,
          country: alert.country,
          latitude: alert.latitude,
          longitude: alert.longitude,
          preferences: normalizeNotificationPreferences(alert.preferences),
        },
        reset_last_notified_on: options?.resetLastNotifiedOn === true,
      });
    },
    []
  );

  const unregisterPushAlert = useCallback(
    async (alertId: string, endpoint?: string) => {
      const subscriptionEndpoint = endpoint || pushSubscription?.endpoint;
      if (!subscriptionEndpoint) {
        return;
      }

      try {
        await axios.post('/api/push/unregister-alert', {
          endpoint: subscriptionEndpoint,
          alert_id: alertId,
        });
      } catch (requestError) {
        console.error(requestError);
      }
    },
    [pushSubscription?.endpoint]
  );

  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      return;
    }
    if (!isBrowserNotificationSupported) {
      return;
    }
    if (window.Notification.permission !== 'default') {
      return;
    }

    let isCancelled = false;

    const requestPermissionOnFirstVisit = async () => {
      try {
        const permission = await window.Notification.requestPermission();
        if (isCancelled) {
          return;
        }
        setBrowserNotificationPermission(permission);
        if (permission === 'granted') {
          await ensurePushSubscription();
        }
      } catch (permissionError) {
        console.error(permissionError);
      }
    };

    void requestPermissionOnFirstVisit();

    return () => {
      isCancelled = true;
    };
  }, [ensurePushSubscription, isBrowserNotificationSupported]);

  useEffect(() => {
    if (browserNotificationPermission !== 'granted') {
      return;
    }
    if (tomorrowAlerts.length === 0) {
      return;
    }

    const syncAlerts = async () => {
      try {
        const subscriptionPayload = await ensurePushSubscription();
        await Promise.all(
          tomorrowAlerts.map((alertItem) => registerPushAlert(alertItem, subscriptionPayload))
        );
      } catch (syncError) {
        console.error(syncError);
      }
    };

    void syncAlerts();
  }, [
    browserNotificationPermission,
    ensurePushSubscription,
    registerPushAlert,
    tomorrowAlerts,
  ]);

  useEffect(() => {
    const previousIds = new Set(previousAlertIdsRef.current);
    const currentIds = new Set(tomorrowAlerts.map((alertItem) => alertItem.id));
    const removedAlertIds = Array.from(previousIds).filter((alertId) => !currentIds.has(alertId));

    if (removedAlertIds.length > 0 && pushSubscription?.endpoint) {
      removedAlertIds.forEach((alertId) => {
        void unregisterPushAlert(alertId, pushSubscription.endpoint);
      });
    }

    previousAlertIdsRef.current = Array.from(currentIds);
  }, [tomorrowAlerts, pushSubscription?.endpoint, unregisterPushAlert]);

  useEffect(() => {
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

          const message = buildTomorrowNotificationText(
            alertItem.label,
            response.data,
            normalizeNotificationPreferences(alertItem.preferences)
          );
          if (!message) {
            continue;
          }
          notificationMessages.push(message);

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
        const selectedPointId = buildPointId(selectedPoint.latitude, selectedPoint.longitude);
        const favoriteForPoint =
          favorites.find((favorite) => favorite.id === selectedPointId) ?? null;
        const isGenericLocation =
          response.data.city === 'Точка на карте' ||
          response.data.country === 'Неизвестная страна';

        if (isGenericLocation && favoriteForPoint) {
          setWeather({
            ...response.data,
            city: favoriteForPoint.label,
            country: favoriteForPoint.country || response.data.country,
          });
        } else {
          setWeather(response.data);
        }
      } catch (requestError) {
        setError('Не удалось загрузить прогноз для выбранной точки.');
        console.error(requestError);
      } finally {
        setWeatherLoading(false);
      }
    };

    loadWeatherByCoordinates();
  }, [favorites, selectedPoint, selectionMode]);

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

  const currentAlert = useMemo(() => {
    if (!currentPointId) {
      return null;
    }

    return tomorrowAlerts.find((alertItem) => alertItem.id === currentPointId) ?? null;
  }, [currentPointId, tomorrowAlerts]);

  const isCurrentFavorite = currentFavorite !== null;

  const isTomorrowAlertEnabled = useMemo(() => {
    if (!currentPointId) {
      return false;
    }

    return tomorrowAlerts.some((alertItem) => alertItem.id === currentPointId);
  }, [currentPointId, tomorrowAlerts]);

  useEffect(() => {
    if (!currentAlert) {
      return;
    }

    setNotificationPreferences(normalizeNotificationPreferences(currentAlert.preferences));
  }, [currentAlert]);

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
    void unregisterPushAlert(favoriteId);
  };

  const handleNotificationPreferenceToggle = (key: keyof NotificationPreferences) => {
    setNotificationPreferences((currentPreferences) => {
      const nextPreferences = {
        ...currentPreferences,
        [key]: !currentPreferences[key],
      };

      if (currentPointId && isTomorrowAlertEnabled) {
        setTomorrowAlerts((currentAlerts) => {
          const nextAlerts = currentAlerts.map((alertItem) =>
            alertItem.id === currentPointId
              ? {
                  ...alertItem,
                  preferences: normalizeNotificationPreferences(nextPreferences),
                }
              : alertItem
          );
          persistTomorrowAlerts(nextAlerts);
          return nextAlerts;
        });
      }

      return nextPreferences;
    });
  };

  const handleToggleTomorrowAlert = async () => {
    if (!weather || !currentPointId || !isCurrentFavorite) {
      return;
    }

    if (isTomorrowAlertEnabled) {
      setTomorrowAlerts((currentAlerts) => {
        const nextAlerts = currentAlerts.filter((alertItem) => alertItem.id !== currentPointId);
        persistTomorrowAlerts(nextAlerts);
        return nextAlerts;
      });
      void unregisterPushAlert(currentPointId);
      setToastLines([`Уведомление для «${weather.city}» отключено.`]);
      return;
    }

    const nextAlert: TomorrowAlert = {
      id: currentPointId,
      label: currentFavorite?.label ?? weather.city,
      country: currentFavorite?.country ?? weather.country,
      latitude: weather.latitude,
      longitude: weather.longitude,
      last_notified_on: null,
      preferences: normalizeNotificationPreferences(notificationPreferences),
    };

    setTomorrowAlerts((currentAlerts) => {
      if (currentAlerts.some((alertItem) => alertItem.id === currentPointId)) {
        return currentAlerts;
      }

      const nextAlerts = [nextAlert, ...currentAlerts];
      persistTomorrowAlerts(nextAlerts);
      return nextAlerts;
    });

    if (!isBrowserNotificationSupported) {
      setToastLines([
        `Уведомление для «${weather.city}» сохранено, но браузер не поддерживает системные уведомления.`,
      ]);
      return;
    }

    if (window.Notification.permission === 'denied') {
      setBrowserNotificationPermission('denied');
      setToastLines([
        `Уведомление для «${weather.city}» сохранено, но уведомления браузера заблокированы.`,
      ]);
      return;
    }

    try {
      const currentPermission = window.Notification.permission;
      let hasGrantedPermission = currentPermission === 'granted';
      if (!hasGrantedPermission) {
        const requestedPermission = await window.Notification.requestPermission();
        setBrowserNotificationPermission(requestedPermission);
        hasGrantedPermission = requestedPermission === 'granted';
      }

      if (!hasGrantedPermission) {
        setToastLines([
          `Уведомление для «${weather.city}» сохранено. Чтобы получать push при закрытой вкладке, разрешите уведомления браузера.`,
        ]);
        return;
      }

      const subscriptionPayload = await ensurePushSubscription();
      await registerPushAlert(nextAlert, subscriptionPayload, { resetLastNotifiedOn: true });
      setToastLines([`Уведомление для «${weather.city}» включено.`]);
    } catch (registrationError) {
      console.error(registrationError);
      setToastLines([
        `Уведомление для «${weather.city}» сохранено, но не удалось сразу синхронизировать push на сервере.`,
      ]);
    }
  };

  const handleThemeToggle = () => {
    setTheme((currentTheme) => (currentTheme === 'light' ? 'dark' : 'light'));
  };

  const handleInstallApp = async () => {
    if (!installPromptEvent) {
      const isIosSafari =
        typeof window !== 'undefined' &&
        /iphone|ipad|ipod/i.test(window.navigator.userAgent) &&
        /safari/i.test(window.navigator.userAgent) &&
        !/crios|fxios|edgios|chrome|android/i.test(window.navigator.userAgent);

      if (isIosSafari) {
        setToastLines([
          'Для iPhone/iPad: нажмите Поделиться в Safari и выберите "На экран Домой".',
        ]);
        return;
      }

      setToastLines([
        'Установка пока недоступна в этом браузере. Попробуйте Chrome/Edge на HTTPS-домене.',
      ]);
      return;
    }

    try {
      await installPromptEvent.prompt();
      const choice = await installPromptEvent.userChoice;
      if (choice.outcome === 'accepted') {
        setToastLines(['Установка приложения подтверждена.']);
      }
    } catch (installError) {
      console.error(installError);
      setToastLines(['Не удалось запустить установку приложения.']);
    } finally {
      setInstallPromptEvent(null);
    }
  };

  const handleTestPush = async () => {
    try {
      if (typeof window === 'undefined' || !('Notification' in window)) {
        setToastLines(['Этот браузер не поддерживает системные уведомления.']);
        return;
      }

      if (window.Notification.permission === 'denied') {
        setBrowserNotificationPermission('denied');
        setToastLines(['Уведомления заблокированы в браузере. Разрешите их в настройках сайта.']);
        return;
      }

      const currentPermission = window.Notification.permission;
      if (currentPermission !== 'granted') {
        const requestedPermission = await window.Notification.requestPermission();
        setBrowserNotificationPermission(requestedPermission);
        if (requestedPermission !== 'granted') {
          setToastLines(['Без разрешения браузера тест push недоступен.']);
          return;
        }
      }

      const subscriptionPayload = await ensurePushSubscription();

      const response = await axios.post<{
        ok: boolean;
        sent: number;
        failed: number;
        targeted: number;
      }>('/api/push/test', {
        endpoint: subscriptionPayload.endpoint,
        subscription: subscriptionPayload,
        title: 'Тест push-уведомления',
        body: 'Если вы видите это системное уведомление, push работает корректно.',
      });

      if (response.data.sent > 0) {
        setToastLines(['Тест push отправлен. Проверьте системное уведомление браузера.']);
        if (typeof window !== 'undefined' && 'Notification' in window) {
          try {
            if (window.Notification.permission === 'granted') {
              new window.Notification('Тест push-уведомления', {
                body: 'Проверка канала push: если вы видите это сообщение, уведомления работают.',
                icon: '/favicon.ico',
                tag: 'manual-push-test-fallback',
              });
            }
          } catch (notificationError) {
            console.error(notificationError);
          }
        }
      } else {
        setToastLines(['Тест push не отправлен. Проверьте подписку и разрешение уведомлений.']);
      }
    } catch (requestError) {
      console.error(requestError);
      const backendDetail =
        axios.isAxiosError(requestError) &&
        requestError.response?.data &&
        typeof (requestError.response.data as { detail?: unknown }).detail === 'string'
          ? ((requestError.response.data as { detail: string }).detail ?? null)
          : null;
      const fallbackMessage =
        requestError instanceof Error ? requestError.message : 'Неизвестная ошибка';
      setToastLines([
        backendDetail
          ? `Ошибка тестового push: ${backendDetail}`
          : `Ошибка тестового push: ${fallbackMessage}`,
      ]);
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

  const canShowInstallButton = !isStandaloneApp;

  return (
    <div className={`app-shell app-shell--${theme}`}>
      <main className="page">
        <div className="top-actions">
          <div className="hero-shortcuts">
            <button className="hero-shortcut-button" onClick={handleScrollToHourly} type="button">
              Перейти к прогнозам
            </button>
            <button className="hero-shortcut-button" onClick={handleScrollToMap} type="button">
              Перейти к карте
            </button>
          </div>

          <div className="page-toolbar">
            {canShowInstallButton && (
              <button className="install-app-button" onClick={handleInstallApp} type="button">
                Установить приложение
              </button>
            )}
            <button className="browser-notification-toggle" onClick={handleTestPush} type="button">
              Тест push
            </button>
            <button className="theme-toggle" onClick={handleThemeToggle} type="button">
              {theme === 'light' ? 'Тёмная тема' : 'Светлая тема'}
            </button>
          </div>
        </div>

        <section className="hero hero--centered" ref={heroSectionRef}>
          <div className="hero__panel hero__panel--summary">
            <p className="hero__panel-label">{overview?.title ?? 'Сводка'}</p>
            <h2>{heroCity?.city ?? 'Выберите город на карте или в Избранном'}</h2>
            <p className="hero__temperature">
              {heroCity ? formatTemperature(heroCity.temperature_c) : '--'}
            </p>
            <p className="hero__meta">
              Ощущается как: {weather ? formatTemperature(weather.feels_like_c) : '--'}
            </p>
            <p className="hero__condition">{heroCity?.condition ?? ''}</p>
          </div>

          <div className="controls-card controls-card--hero">
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

          </div>
        </section>

        <section className="dashboard">
          <aside className="hero__panel hero__settings" aria-label="Настройка уведомлений">
            <p className="hero__panel-label">Настройка уведомлений</p>
            <h3>Выберите параметры в алерте</h3>
            <p className="hero__settings-hint">
              {weather
                ? `${weather.city}, ${weather.country}`
                : 'Выберите город для настройки уведомлений'}
            </p>

            <div className="hero__settings-options">
              {NOTIFICATION_PREFERENCE_OPTIONS.map((option) => (
                <label className="hero__settings-option" key={option.key}>
                  <input
                    checked={notificationPreferences[option.key]}
                    onChange={() => handleNotificationPreferenceToggle(option.key)}
                    type="checkbox"
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>

            <button
              className={`notification-settings__toggle ${
                isTomorrowAlertEnabled
                  ? 'notification-settings__toggle--off'
                  : 'notification-settings__toggle--on'
              }`}
              disabled={!weather || !isCurrentFavorite}
              onClick={handleToggleTomorrowAlert}
              type="button"
            >
              {isTomorrowAlertEnabled ? 'Отключить уведомления' : 'Включить уведомления'}
            </button>
            {!isCurrentFavorite && (
              <small className="hero__settings-note">
                Добавьте выбранный город в избранное, чтобы включить уведомления.
              </small>
            )}
          </aside>

          <div className="controls-card controls-card--favorites">
            <div>
              <p className="section-label">Избранное</p>
              <h3>Сохраненные локации</h3>
            </div>

            <div className="favorites-panel">
              

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

          <div className="weather-card weather-card--dashboard">
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

        <button className="scroll-top-button" onClick={handleScrollToTop} type="button">
          ↑
        </button>

      </main>
    </div>
  );
}

export default App;

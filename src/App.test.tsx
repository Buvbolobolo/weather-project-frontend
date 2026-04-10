import React from 'react';
import { render, screen } from '@testing-library/react';
import axios from 'axios';
import App from './App';

jest.mock('axios');
jest.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Marker: () => <div>marker</div>,
  Popup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TileLayer: () => <div>tile</div>,
  useMap: () => ({
    setView: jest.fn(),
    getZoom: () => 5,
  }),
  useMapEvents: () => undefined,
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;

test('renders weather dashboard title', async () => {
  mockedAxios.get.mockImplementation((url) => {
    if (url === '/api/cities') {
      return Promise.resolve({
        data: [
          {
            name: 'Барнаул',
            country: 'Россия',
            condition: 'Облачно',
            temperature_c: 8,
            latitude: 53.3474,
            longitude: 83.7784,
          },
        ],
      });
    }

    if (url === '/api/overview') {
      return Promise.resolve({
        data: {
          title: 'Погодная сводка',
          description: 'Описание',
          cities_count: 1,
          highlight: {
            city: 'Барнаул',
            temperature_c: 8,
            condition: 'Облачно',
          },
        },
      });
    }

    return Promise.resolve({
      data: {
        city: 'Барнаул',
        country: 'Россия',
        latitude: 53.3474,
        longitude: 83.7784,
        updated_at: '01.04.2026 15:45',
        condition: 'Облачно',
        temperature_c: 8,
        feels_like_c: 5,
        humidity: 60,
        wind_speed: 4.5,
        pressure_mmhg: 758,
        visibility_km: 10,
        forecast: [],
      },
    });
  });

  render(<App />);

  expect(
    await screen.findByText(/Погода по городам и координатам/i)
  ).toBeInTheDocument();
});

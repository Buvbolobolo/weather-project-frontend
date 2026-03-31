import React from 'react';
import { render, screen } from '@testing-library/react';
import axios from 'axios';
import App from './App';

jest.mock('axios');

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
        updated_at: '25 марта 2026, 17:00',
        condition: 'Облачно',
        temperature_c: 8,
        feels_like_c: 5,
        humidity: 60,
        wind_speed: 4.5,
        pressure_hpa: 1010,
        visibility_km: 10,
        forecast: [],
      },
    });
  });

  render(<App />);

  expect(
    await screen.findByText(/Погода по городам в одном аккуратном дашборде/i)
  ).toBeInTheDocument();
});

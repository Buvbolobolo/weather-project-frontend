self.addEventListener('push', (event) => {
  if (!event.data) {
    return;
  }

  let payload = {};
  try {
    payload = event.data.json();
  } catch (error) {
    payload = { title: 'Прогноз на завтра', body: event.data.text() };
  }

  const title = payload.title || 'Прогноз на завтра';
  const body = payload.body || 'Появилось новое погодное уведомление.';
  const options = {
    body,
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    tag: payload.tag || 'weather-push-alert',
    renotify: true,
    data: {
      url: '/',
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }

      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
      return Promise.resolve();
    })
  );
});

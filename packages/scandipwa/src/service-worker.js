/* eslint-disable @scandipwa/scandipwa-guidelines/export-level-one */
import { clientsClaim } from 'workbox-core';
import { ExpirationPlugin } from 'workbox-expiration';
import { precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { StaleWhileRevalidate } from 'workbox-strategies';

clientsClaim();

// Precache all of the assets generated by your build process.
// Their URLs are injected into the manifest variable below.
// This variable must be present somewhere in your service worker file,
// even if you decide not to use precaching. See https://cra.link/PWA
precacheAndRoute(self.__WB_MANIFEST);

// Cache same-origin image requests
registerRoute(
    ({ url }) => (
        url.origin === self.location.origin
        // cache png, gif, jpeg, jpg in image cache
        && /.(jpe?g|png|gif)$/.test(url.pathname)
    ),
    new StaleWhileRevalidate({
        cacheName: 'images',
        plugins: [
            // Ensure that once this runtime cache reaches a maximum size the
            // least-recently used images are removed.
            new ExpirationPlugin({ maxEntries: 50 })
        ]
    })
);

// This allows the web app to trigger skipWaiting via
// registration.waiting.postMessage({type: 'SKIP_WAITING'})
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

const RESPONSE_OK = 200;

const makeRequestAndUpdateCache = async (request, cache) => {
    const response = await fetch(request);
    const isValid = response.status === RESPONSE_OK;

    if (isValid) {
        cache.put(request.url, response.clone());
    }

    return response;
};

const updateWithFreshDataViaBroadcast = async (request, cache) => {
    const type = request.headers.get('Application-Model');
    const revalidatedResponse = await makeRequestAndUpdateCache(request, cache);
    const responseClone = revalidatedResponse.clone();
    const broadcast = new BroadcastChannel(type);
    broadcast.postMessage({ payload: await responseClone.json(), type });
    broadcast.close();
};

registerRoute(
    /\/graphql/,
    async ({ event }) => {
        const { request } = event;
        const cache = await caches.open('graphql');
        const cachedResponse = await cache.match(request);

        if (!cachedResponse) {
            // If there is no cached response,
            // we must get the response and save it to cache!
            return makeRequestAndUpdateCache(request, cache);
        }

        // For cached response, still do the request, but in background.
        // We will use the BroadCast channel to update the client if the data is new
        updateWithFreshDataViaBroadcast(request, cache);

        return cachedResponse;
    }
);

// respond to document request only in offline
registerRoute(
    ({ request }) => {
        const { url, destination } = request;
        const { hostname } = new URL(url);

        if (destination !== 'document') {
            // skip all NON documents
            return false;
        }

        if (hostname !== self.location.hostname) {
            // skip requests to other domains
            return false;
        }

        return true;
    },
    async ({ event }) => {
        const { request } = event;

        const cache = await caches.open(self.CACHE_NAME);
        const responseFromCache = await cache.match('/');

        if (!navigator.onLine) {
            // Always respond from cache if we are offline
            return responseFromCache;
        }

        if (!responseFromCache) {
            // Respond from server
            const rootResponse = await fetch('/');

            if (rootResponse.status === RESPONSE_OK) {
                // Cache only 200 responses, to make sure, that when we are
                // offline the page will still load as normal.
                cache.put('/', rootResponse.clone());
            }
        }

        return fetch(request); // respond from server
    }
);
import { configureStore, createListenerMiddleware } from '@reduxjs/toolkit';
import authReducer from './slices/authSlice';
import tableReducer from './slices/tableSlice';
import orderReducer, { setOrders } from './slices/orderSlice';
import menuReducer, { setMenuItems } from './slices/menuSlice';
import inventoryReducer from './slices/inventorySlice';
import dealReducer, { setDeals } from './slices/dealSlice';
import { getCurrentRestaurantId } from '../lib/session';

/**
 * Browser caches are keyed by restaurant id. Whenever the signed-in business
 * changes (login, logout, or support impersonation), drop the in-memory copies
 * so a record selected in one business can never be submitted to another.
 */
const tenantResetMiddleware = createListenerMiddleware();
let activeRestaurantId = getCurrentRestaurantId();

tenantResetMiddleware.startListening({
  predicate: (_action, currentState) => {
    const state = currentState as any;
    const nextRestaurantId = state?.auth?.user?.restaurantId ?? null;
    return nextRestaurantId !== activeRestaurantId;
  },
  effect: (_action, listenerApi) => {
    const state = listenerApi.getState() as any;
    activeRestaurantId = state?.auth?.user?.restaurantId ?? null;
    listenerApi.dispatch(setMenuItems([]));
    listenerApi.dispatch(setOrders([]));
    listenerApi.dispatch(setDeals([]));
  },
});

export const store = configureStore({
  reducer: {
    auth: authReducer,
    tables: tableReducer,
    orders: orderReducer,
    menu: menuReducer,
    inventory: inventoryReducer,
    deal: dealReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: false,
    }).prepend(tenantResetMiddleware.middleware),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

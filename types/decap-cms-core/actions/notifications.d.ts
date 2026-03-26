import type { TypeOptions } from 'react-toastify';
export interface NotificationMessage {
    details?: unknown;
    key: string;
}
export interface NotificationPayload {
    message: string | NotificationMessage;
    dismissAfter?: number;
    type: TypeOptions | undefined;
}
export declare const NOTIFICATION_SEND = "NOTIFICATION_SEND";
export declare const NOTIFICATION_DISMISS = "NOTIFICATION_DISMISS";
export declare const NOTIFICATIONS_CLEAR = "NOTIFICATION_CLEAR";
declare function addNotification(notification: NotificationPayload): {
    type: string;
    payload: NotificationPayload;
};
declare function dismissNotification(id: string): {
    type: string;
    id: string;
};
declare function clearNotifications(): {
    type: string;
};
export type NotificationsAction = {
    type: typeof NOTIFICATION_DISMISS | typeof NOTIFICATION_SEND | typeof NOTIFICATIONS_CLEAR;
    payload?: NotificationPayload;
    id?: string;
};
export { addNotification, dismissNotification, clearNotifications };

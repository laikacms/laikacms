import type { NotificationMessage } from '../actions/notifications';
import type { TypeOptions } from 'react-toastify';
export type Notification = {
    id: string;
    message: string | NotificationMessage;
    dismissAfter?: number;
    type: TypeOptions | undefined;
};
export type NotificationsState = {
    notifications: Notification[];
};
declare const notifications: any;
export default notifications;

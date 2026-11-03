import { useTranslation } from 'react-i18next';

interface ConfirmModalProps {
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  isPending?: boolean;
}

export function ConfirmModal({ title, message, confirmLabel, onConfirm, onCancel, isPending }: ConfirmModalProps) {
  const { t } = useTranslation('common');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onCancel}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-gray-900 mb-2">{title}</h2>
        <p className="text-sm text-gray-500 mb-6">{message}</p>
        <div className="flex justify-end gap-3">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">
            {t('confirmModal.cancel')}
          </button>
          <button
            onClick={onConfirm}
            disabled={isPending}
            className="px-4 py-2 text-sm bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white rounded-lg font-medium"
          >
            {isPending ? t('confirmModal.deleting') : (confirmLabel ?? t('confirmModal.delete'))}
          </button>
        </div>
      </div>
    </div>
  );
}

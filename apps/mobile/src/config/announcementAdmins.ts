// 固定名单，不从设备设置或链上转账动态增加管理员。
// 已核实的转账：1.11.20751，init0 -> djw147258，10000 DFS。
export const ANNOUNCEMENT_ADMINS = [
  { id: '1.2.185992', name: 'djw147258' },
  { id: '1.2.100', name: 'init0' },
] as const;

export const ANNOUNCEMENT_ADMIN_ACCOUNT_IDS = ANNOUNCEMENT_ADMINS.map(account => account.id);
export const kAppStorageKeyAnnouncementAdmins = 'announcement_admins.v1';

let configuredAdmins: Array<{ id: string; name: string }> = [];

export const setConfiguredAnnouncementAdmins = (admins: Array<{ id: string; name: string }>): void => {
  configuredAdmins = admins.filter(admin =>
    admin.id && admin.name && !ANNOUNCEMENT_ADMIN_ACCOUNT_IDS.includes(admin.id as typeof ANNOUNCEMENT_ADMIN_ACCOUNT_IDS[number]),
  );
};

export const getConfiguredAnnouncementAdmins = (): Array<{ id: string; name: string }> => configuredAdmins;

export const isAnnouncementAdmin = (
  account: { id: string; name: string } | null | undefined,
): boolean => !!account && [...ANNOUNCEMENT_ADMINS, ...configuredAdmins].some(
  admin => admin.id === account.id && admin.name === account.name,
);

export const isAnnouncementRootAdmin = (
  account: { id: string; name: string } | null | undefined,
): boolean => !!account && ANNOUNCEMENT_ADMINS.some(
  admin => admin.id === account.id && admin.name === account.name,
);

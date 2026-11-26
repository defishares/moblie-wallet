import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StatusBar, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import { Text } from '@rneui/themed';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import { useAccountStore } from '../store/useAccountStore';
import { secureStorageService, unlockSession, chainServiceMgr, backgroundService, formatGrapheneError } from '../services';
import {
  kAppStorageCatalogAppSettings, kAppStorageKeyAnnouncements, kAppStorageKeyAnnouncementAdmins,
  isAnnouncementAdmin, isAnnouncementRootAdmin,
} from '../config';
import { parseAnnouncementList, parseAnnouncementAdminList } from '../utils/announcements';
import { StorageConfirmationPendingError, type AccountStorageUpdate } from '../utils/accountStorage';

type PendingWrite = { params: AccountStorageUpdate; action: 'publish' | 'authorize' | 'delete' };

const AnnouncementAdminScreen: React.FC = () => {
  const navigation = useNavigation();
  const currentAccount = useAccountStore(state => state.currentAccount);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [expiryDays, setExpiryDays] = useState('');
  const [myAnnouncements, setMyAnnouncements] = useState<ReturnType<typeof parseAnnouncementList>>([]);
  const [pin, setPin] = useState('');
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const [pendingWrite, setPendingWrite] = useState<PendingWrite | null>(null);
  const [newAdminId, setNewAdminId] = useState('');
  const [newAdminName, setNewAdminName] = useState('');
  const [authorizedAdmins, setAuthorizedAdmins] = useState<Array<{ id: string; name: string }>>([]);
  const isAdmin = isAnnouncementAdmin(currentAccount);
  const isRoot = isAnnouncementRootAdmin(currentAccount);
  const editable = !saving && !pendingWrite;

  useEffect(() => { if (!isAdmin) navigation.goBack(); }, [isAdmin, navigation]);
  useEffect(() => { setPin(''); setPendingWrite(null); }, [currentAccount?.id]);

  const loadAuthorizedAdmins = useCallback(async () => {
    if (!currentAccount || !isAnnouncementRootAdmin(currentAccount)) return;
    const rows = await chainServiceMgr.getStorageInfo(currentAccount.id, kAppStorageCatalogAppSettings);
    const entry = rows.find((item: any) => item.key === kAppStorageKeyAnnouncementAdmins);
    const list = entry ? parseAnnouncementAdminList(entry.value) : [];
    if (useAccountStore.getState().currentAccount?.id === currentAccount.id) setAuthorizedAdmins(list);
  }, [currentAccount]);

  const loadMyAnnouncements = useCallback(async () => {
    if (!currentAccount || !isAnnouncementAdmin(currentAccount)) return;
    const rows = await chainServiceMgr.getStorageInfo(currentAccount.id, kAppStorageCatalogAppSettings);
    const entry = rows.find((item: any) => item.key === kAppStorageKeyAnnouncements);
    const list = entry ? parseAnnouncementList(entry.value) : [];
    if (useAccountStore.getState().currentAccount?.id === currentAccount.id) setMyAnnouncements(list);
  }, [currentAccount]);

  useEffect(() => {
    loadAuthorizedAdmins().catch(() => {});
    loadMyAnnouncements().catch(() => {});
  }, [loadAuthorizedAdmins, loadMyAnnouncements]);

  const finishWrite = async (write: PendingWrite) => {
    setPendingWrite(null);
    setPin('');
    if (write.action === 'authorize') {
      setNewAdminId(''); setNewAdminName('');
      await loadAuthorizedAdmins().catch(() => {});
    } else if (write.action === 'publish') {
      setTitle(''); setContent(''); setExpiryDays('');
    }
    await loadMyAnnouncements().catch(() => {});
    const refreshed = await backgroundService.refreshChainConfig();
    Alert.alert(write.action === 'authorize' ? '配置成功' : write.action === 'delete' ? '删除成功' : '发布成功', refreshed
      ? (write.action === 'authorize' ? '发布权限已写入链上并生效。' : write.action === 'delete' ? '公告已从链上删除并同步到首页。' : '公告已上链并同步到首页。')
      : '已确认写入链上，页面数据将在下次刷新时同步。');
  };

  const performWrite = async (write: PendingWrite) => {
    const ensureAccount = () => {
      const account = useAccountStore.getState().currentAccount;
      const allowed = write.action === 'authorize' ? isAnnouncementRootAdmin(account) : isAnnouncementAdmin(account);
      if (!allowed || account?.id !== write.params.accountId) throw new Error('账号或权限已变化，请重新进入管理页面');
    };
    ensureAccount();
    const keys = await secureStorageService.retrievePrivateKeyWithPin(write.params.accountId, pin);
    setPin('');
    if (!keys.success || !keys.privateKey) throw new Error(keys.error || 'PIN 验证失败');
    ensureAccount();
    try {
      await chainServiceMgr.accountStorageMap(write.params, keys.privateKey);
    } catch (error) {
      if (error instanceof StorageConfirmationPendingError) {
        setPendingWrite(write);
        Alert.alert('已广播，等待确认', error.message);
        return;
      }
      throw error;
    }
    await finishWrite(write);
  };

  const run = async (action: () => Promise<void>, failureTitle: string) => {
    if (busy.current || pendingWrite) return;
    if (!pin && !unlockSession.isActive(currentAccount?.id || '')) {
      Alert.alert('请输入 PIN', '解锁后 1 小时内无需重复验证。'); return;
    }
    busy.current = true; setSaving(true);
    try { await action(); }
    catch (error) { Alert.alert(failureTitle, formatGrapheneError(error)); }
    finally { busy.current = false; setSaving(false); }
  };

  const authorizeAdmin = () => run(async () => {
    if (!currentAccount || !isAnnouncementRootAdmin(currentAccount)) throw new Error('仅超级管理员可以配置发布管理员');
    const id = newAdminId.trim();
    const name = newAdminName.trim();
    if (!id || !name) throw new Error('请填写账号 ID 和账号名称');
    const account = await chainServiceMgr.getAccountByName(name);
    if (!account || account.id !== id) throw new Error('账号 ID 与链上账号名称不匹配');
    const rows = await chainServiceMgr.getStorageInfo(currentAccount.id, kAppStorageCatalogAppSettings);
    const entry = rows.find((item: any) => item.key === kAppStorageKeyAnnouncementAdmins);
    const existing = entry ? parseAnnouncementAdminList(entry.value) : [];
    if (isAnnouncementRootAdmin({ id, name }) || existing.some(item => item.id === id && item.name === name)) {
      Alert.alert('已获得权限', '该账号已拥有公告管理权限。'); return;
    }
    const next = [...existing.filter(item => item.id !== id), { id, name }];
    await performWrite({ action: 'authorize', params: {
      accountId: currentAccount.id, remove: false, catalog: kAppStorageCatalogAppSettings,
      keyValues: [[kAppStorageKeyAnnouncementAdmins, JSON.stringify(next)]],
    } });
  }, '配置失败');

  const publish = () => run(async () => {
    if (!currentAccount || !isAnnouncementAdmin(currentAccount)) throw new Error('当前账号没有公告发布权限');
    if (!title.trim() || !content.trim()) throw new Error('请填写公告标题和内容');
    const days = expiryDays.trim() ? Number(expiryDays.trim()) : 0;
    if (!Number.isFinite(days) || days < 0 || days > 3650) throw new Error('显示期限请输入 0～3650 天，留空表示长期显示');
    const old = await chainServiceMgr.getStorageInfo(currentAccount.id, kAppStorageCatalogAppSettings);
    const existing = old.find((item: any) => item.key === kAppStorageKeyAnnouncements);
    const announcements = existing ? parseAnnouncementList(existing.value) : [];
    const next = [{
      id: `announcement-${Date.now()}`, title: title.trim(), content: content.trim(),
      type: 'new_coin', enabled: true, sort: 1, publishedAt: Date.now(),
      expiresAt: days > 0 ? Date.now() + Math.round(days * 24 * 60 * 60 * 1000) : 0,
    }, ...announcements].map((item, index) => ({ ...item, sort: index + 1 }));
    await performWrite({ action: 'publish', params: {
      accountId: currentAccount.id, remove: false, catalog: kAppStorageCatalogAppSettings,
      keyValues: [[kAppStorageKeyAnnouncements, JSON.stringify(next)]],
    } });
  }, '发布失败');

  const deleteAnnouncement = (announcementId: string) => Alert.alert(
    '删除公告', '删除后会从链上公告列表移除，确定继续吗？', [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => run(async () => {
        if (!currentAccount || !isAnnouncementAdmin(currentAccount)) throw new Error('当前账号没有公告管理权限');
        const rows = await chainServiceMgr.getStorageInfo(currentAccount.id, kAppStorageCatalogAppSettings);
        const entry = rows.find((item: any) => item.key === kAppStorageKeyAnnouncements);
        const existing = entry ? parseAnnouncementList(entry.value) : [];
        const next = existing.filter(item => item.id !== announcementId);
        if (next.length === existing.length) throw new Error('公告不存在或已被删除');
        await performWrite({ action: 'delete', params: {
          accountId: currentAccount.id, remove: false, catalog: kAppStorageCatalogAppSettings,
          keyValues: [[kAppStorageKeyAnnouncements, JSON.stringify(next)]],
        } });
      }, '删除失败') },
    ],
  );

  const retryConfirmation = async () => {
    if (!pendingWrite || busy.current) return;
    busy.current = true; setSaving(true);
    try {
      if (await chainServiceMgr.confirmAccountStorageMap(pendingWrite.params)) await finishWrite(pendingWrite);
      else Alert.alert('仍在等待确认', '暂未读到写入结果，请稍后再刷新。此次刷新不会再次广播或扣费。');
    } catch (error) { Alert.alert('确认失败', formatGrapheneError(error)); }
    finally { busy.current = false; setSaving(false); }
  };

  if (!isAdmin) return <SafeAreaView style={styles.container}><Text style={styles.hint}>无公告管理权限</Text></SafeAreaView>;

  return <SafeAreaView style={styles.container} edges={['top']}>
    <StatusBar barStyle="light-content" backgroundColor="#0D0D0D" />
    <View style={styles.header}>
      <TouchableOpacity onPress={() => navigation.goBack()}><Icon name="arrow-left" size={24} color="#FFF" /></TouchableOpacity>
      <Text style={styles.headerTitle}>公告管理</Text><View style={styles.headerSpacer} />
    </View>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.label}>当前管理员</Text><Text style={styles.input}>{currentAccount?.name}（{currentAccount?.id}）</Text>
      {isRoot && <>
        <Text style={styles.label}>新增发布管理员账号 ID</Text><TextInput value={newAdminId} onChangeText={setNewAdminId} editable={editable} placeholder="例如 1.2.12345" placeholderTextColor="#666" style={styles.input} autoCapitalize="none" />
        <Text style={styles.label}>新增发布管理员名称</Text><TextInput value={newAdminName} onChangeText={setNewAdminName} editable={editable} placeholder="链上账号名称" placeholderTextColor="#666" style={styles.input} autoCapitalize="none" />
        {authorizedAdmins.length > 0 && <Text style={styles.hint}>已配置：{authorizedAdmins.map(item => `${item.name}（${item.id}）`).join('、')}</Text>}
        <TouchableOpacity style={styles.secondaryButton} onPress={authorizeAdmin} disabled={!editable}><Text style={styles.secondaryButtonText}>配置发布管理员</Text></TouchableOpacity>
      </>}
      <Text style={styles.label}>公告标题</Text><TextInput value={title} onChangeText={setTitle} editable={editable} placeholder="新币上线" placeholderTextColor="#666" style={styles.input} />
      <Text style={styles.label}>公告内容</Text><TextInput value={content} onChangeText={setContent} editable={editable} placeholder="输入要展示的公告内容" placeholderTextColor="#666" style={[styles.input, styles.multiline]} multiline />
      <Text style={styles.label}>显示期限（天）</Text><TextInput value={expiryDays} onChangeText={setExpiryDays} editable={editable} placeholder="留空为长期显示，例如 7" placeholderTextColor="#666" style={styles.input} keyboardType="number-pad" />
      <Text style={styles.hint}>公告到期后会自动从首页隐藏；填写 0 或留空表示长期显示。</Text>
      {myAnnouncements.length > 0 && <View style={styles.listSection}>
        <Text style={styles.label}>我发布的公告</Text>
        {myAnnouncements.map(item => {
          const expiry = item.expiresAt && item.expiresAt > 0 ? new Date(item.expiresAt).toLocaleDateString() : '长期显示';
          return <View key={item.id} style={styles.announcementRow}>
            <View style={styles.announcementRowText}><Text style={styles.announcementRowTitle}>{item.title}</Text><Text style={styles.hint}>显示至：{expiry}</Text></View>
            <TouchableOpacity onPress={() => deleteAnnouncement(item.id)} disabled={!editable}><Text style={styles.deleteText}>删除</Text></TouchableOpacity>
          </View>;
        })}
      </View>}
      <Text style={styles.label}>PIN 码（解锁后 1 小时内可留空）</Text><TextInput value={pin} onChangeText={setPin} editable={editable} placeholder="首次解锁或到期后请输入 PIN" placeholderTextColor="#666" style={styles.input} secureTextEntry keyboardType="number-pad" />
      {pendingWrite ? <>
        <Text style={styles.hint}>交易已广播，正在等待节点确认。请刷新状态，避免重复发布。</Text>
        <TouchableOpacity style={styles.button} onPress={retryConfirmation} disabled={saving}>{saving ? <ActivityIndicator color="#0D0D0D" /> : <Text style={styles.buttonText}>刷新发布状态</Text>}</TouchableOpacity>
      </> : <TouchableOpacity style={styles.button} onPress={publish} disabled={saving}>{saving ? <ActivityIndicator color="#0D0D0D" /> : <Text style={styles.buttonText}>签名并广播公告</Text>}</TouchableOpacity>}
    </ScrollView>
  </SafeAreaView>;
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D0D' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: '#222' },
  headerSpacer: { width: 24 }, headerTitle: { color: '#FFF', fontSize: 18, fontWeight: '600' },
  content: { padding: 20 }, hint: { color: '#888', fontSize: 12, marginBottom: 24 },
  label: { color: '#CCC', fontSize: 13, marginBottom: 8, marginTop: 14 },
  input: { backgroundColor: '#1B1B1B', color: '#FFF', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  multiline: { minHeight: 110, textAlignVertical: 'top' },
  button: { marginTop: 28, backgroundColor: '#00D094', borderRadius: 8, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#0D0D0D', fontSize: 16, fontWeight: '700' },
  secondaryButton: { marginTop: 14, borderWidth: 1, borderColor: '#00D094', borderRadius: 8, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  secondaryButtonText: { color: '#00D094', fontSize: 15, fontWeight: '600' },
  listSection: { marginTop: 8 },
  announcementRow: { backgroundColor: '#181818', borderRadius: 8, padding: 12, marginTop: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  announcementRowText: { flex: 1, marginRight: 12 },
  announcementRowTitle: { color: '#FFF', fontSize: 14, marginBottom: 4 },
  deleteText: { color: '#FF6B6B', fontSize: 14, fontWeight: '600' },
});

export default AnnouncementAdminScreen;

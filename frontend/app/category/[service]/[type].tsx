import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useContentStore } from '../../../src/store/contentStore';
import { ContentItem } from '../../../src/api/client';

const { width } = Dimensions.get('window');
const ITEM_WIDTH = (width - 48) / 3; // 3 columns with padding
const ITEM_HEIGHT = ITEM_WIDTH * 1.5;

export default function CategoryScreen() {
  const { service, type } = useLocalSearchParams<{ service: string; type: string }>();
  const router = useRouter();
  const { discoverData } = useContentStore();
  const [items, setItems] = useState<ContentItem[]>([]);

  useEffect(() => {
    if (discoverData && service) {
      const decodedService = decodeURIComponent(service);
      const serviceData = discoverData.services[decodedService];
      if (serviceData) {
        let categoryItems: ContentItem[] = [];
        if (type === 'movies') {
          categoryItems = serviceData.movies || [];
        } else if (type === 'series') {
          categoryItems = serviceData.series || [];
        } else if (type === 'channels') {
          categoryItems = serviceData.channels || [];
        }
        setItems(categoryItems.filter(Boolean));
      }
    }
  }, [discoverData, service, type]);

  const handleItemPress = (item: ContentItem) => {
    const id = item.imdb_id || item.id;
    const encodedId = encodeURIComponent(id);
    router.push({
      pathname: `/details/${item.type}/${encodedId}`,
      params: {
        name: item.name || '',
        poster: item.poster || '',
      }
    });
  };

  const renderItem = ({ item }: { item: ContentItem }) => (
    <TouchableOpacity 
      style={styles.itemContainer}
      onPress={() => handleItemPress(item)}
      activeOpacity={0.7}
    >
      <Image
        source={{ uri: item.poster }}
        style={styles.poster}
        contentFit="cover"
        placeholder={require('../../../assets/images/icon.png')}
        placeholderContentFit="contain"
      />
      <Text style={styles.itemTitle} numberOfLines={2}>{item.name}</Text>
    </TouchableOpacity>
  );

  const decodedService = service ? decodeURIComponent(service) : '';
  const typeLabel = type === 'movies' ? 'Movies' : type === 'series' ? 'Series' : 'Channels';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{decodedService} {typeLabel}</Text>
        <View style={styles.placeholder} />
      </View>

      {/* Content Grid */}
      {items.length === 0 ? (
        <View style={styles.emptyContainer}>
          <ActivityIndicator size="large" color="#B8A05C" />
        </View>
      ) : (
        <FlatList
          data={items}
          renderItem={renderItem}
          keyExtractor={(item, index) => item.id || item.imdb_id || index.toString()}
          numColumns={3}
          contentContainerStyle={styles.gridContent}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f11',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1d',
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
  },
  placeholder: {
    width: 40,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  gridContent: {
    padding: 16,
  },
  itemContainer: {
    width: ITEM_WIDTH,
    marginBottom: 16,
    marginHorizontal: 4,
  },
  poster: {
    width: '100%',
    height: ITEM_HEIGHT,
    borderRadius: 8,
    backgroundColor: '#1a1a1d',
  },
  itemTitle: {
    color: '#FFFFFF',
    fontSize: 12,
    marginTop: 6,
    textAlign: 'center',
  },
});

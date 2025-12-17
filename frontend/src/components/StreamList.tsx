import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stream } from '../api/client';

interface StreamListProps {
  streams: Stream[];
  isLoading: boolean;
  onStreamSelect: (stream: Stream) => void;
}

export const StreamList: React.FC<StreamListProps> = ({
  streams,
  isLoading,
  onStreamSelect,
}) => {
  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#B8A05C" />
        <Text style={styles.loadingText}>Finding streams...</Text>
      </View>
    );
  }

  if (streams.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="cloud-offline-outline" size={48} color="#666666" />
        <Text style={styles.emptyText}>No streams available</Text>
        <Text style={styles.emptySubtext}>Try installing more addons</Text>
      </View>
    );
  }

  const parseStreamInfo = (stream: Stream) => {
    const title = stream.title || stream.name || 'Unknown Stream';
    const lines = title.split('\n');
    const quality = lines[0];
    const info = lines.slice(1).join(' ');
    return { quality, info };
  };

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <Text style={styles.header}>Available Streams ({streams.length})</Text>
      {streams.map((stream, index) => {
        const { quality, info } = parseStreamInfo(stream);
        return (
          <TouchableOpacity
            key={index}
            style={styles.streamItem}
            onPress={() => onStreamSelect(stream)}
            activeOpacity={0.7}
          >
            <View style={styles.streamIcon}>
              <Ionicons name="play-circle" size={32} color="#B8A05C" />
            </View>
            <View style={styles.streamInfo}>
              <Text style={styles.streamQuality}>{quality}</Text>
              {info && <Text style={styles.streamDetails} numberOfLines={2}>{info}</Text>}
            </View>
            <Ionicons name="chevron-forward" size={24} color="#666666" />
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  loadingText: {
    color: '#FFFFFF',
    marginTop: 12,
    fontSize: 16,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
    marginTop: 12,
  },
  emptySubtext: {
    color: '#888888',
    fontSize: 14,
    marginTop: 4,
  },
  header: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  streamItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 12,
    borderRadius: 8,
  },
  streamIcon: {
    marginRight: 12,
  },
  streamInfo: {
    flex: 1,
  },
  streamQuality: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  streamDetails: {
    color: '#888888',
    fontSize: 12,
    marginTop: 2,
  },
});

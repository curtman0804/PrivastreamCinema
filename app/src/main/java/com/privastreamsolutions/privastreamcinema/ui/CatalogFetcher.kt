package com.privastreamsolutions.privastreamcinema.ui

import android.util.Log
import com.privastreamsolutions.privastreamcinema.model.MediaItem
import com.privastreamsolutions.privastreamcinema.util.InstalledAddons
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject

object CatalogFetcher {

    private val client = OkHttpClient()

    suspend fun fetchAllCatalogs(): Map<String, List<MediaItem>> {
        val sectionMap = mutableMapOf<String, MutableList<MediaItem>>()

        val allowedTypes = setOf("movie", "series")
        val blockedIds = setOf("calendar", "calendar-videos", "last", "last-videos")

        for (addon in InstalledAddons.all()) {
            val catalogs = addon.catalogs ?: continue
            val baseUrl = addon.addonUrl
                ?.removeSuffix("manifest.json")
                ?.removeSuffix("/") ?: continue

            for (catalog in catalogs) {
                val type = catalog.type?.lowercase() ?: continue
                val id = catalog.id?.lowercase() ?: continue
                val name = catalog.name ?: continue

                Log.d("CatalogDebug", "🔍 Reviewing: id=$id, type=$type, name=$name")

                if (blockedIds.contains(id)) {
                    Log.d("CatalogDebug", "⛔ Skipped: blocked ID → $id")
                    continue
                }
                if (name.lowercase().contains("calendar") || name.lowercase().contains("last")) {
                    Log.d("CatalogDebug", "⛔ Skipped: blocked name → $name")
                    continue
                }
                if (!allowedTypes.contains(type)) {
                    Log.d("CatalogDebug", "⛔ Skipped: type mismatch → $type")
                    continue
                }

                val label = "$name – ${type.replaceFirstChar { it.uppercase() }}"
                val fullUrl = "$baseUrl/catalog/$type/$id.json"

                Log.d("CatalogDebug", "✅ Fetching: $label → $fullUrl")

                try {
                    val rawJson = withContext(Dispatchers.IO) {
                        val request = Request.Builder().url(fullUrl).build()
                        val response = client.newCall(request).execute()
                        val body = response.body()?.string() ?: ""

                        if (body.trim().startsWith("<!DOCTYPE") || body.contains("<html")) {
                            throw Exception("HTML response detected")
                        }

                        body
                    }

                    val json = JSONObject(rawJson)
                    val metas = json.optJSONArray("metas") ?: continue

                    for (i in 0 until metas.length()) {
                        val obj = metas.optJSONObject(i) ?: continue
                        val media = MediaItem(
                            name = obj.optString("name"),
                            poster = obj.optString("poster"),
                            description = obj.optString("description"),
                            streamUrl = obj.optString("id")
                        )

                        sectionMap.getOrPut(label) { mutableListOf() }.add(media)
                    }

                    Log.d("CatalogDebug", "📦 $label: ${metas.length()} items")

                } catch (e: Exception) {
                    Log.e("CatalogFetcher", "❌ Failed: $label", e)
                }
            }
        }

        return sectionMap
    }
}
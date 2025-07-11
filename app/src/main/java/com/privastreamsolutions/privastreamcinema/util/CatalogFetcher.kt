package com.privastreamsolutions.privastreamcinema.util

import android.util.Log
import com.privastreamsolutions.privastreamcinema.model.AddonManifest
import com.privastreamsolutions.privastreamcinema.model.MediaItem
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject

object CatalogFetcher {

    private val client = OkHttpClient()

    suspend fun fetchCatalogsFrom(addons: List<AddonManifest>): Map<String, List<MediaItem>> {
        val finalSections = linkedMapOf<String, List<MediaItem>>() // preserves install order

        val blockedNames = setOf("last", "calendar", "last videos", "calendar videos")

        for (addon in addons.sortedBy { it.installedAt }) {
            val catalogs = addon.catalogs ?: continue
            val baseUrl = addon.addonUrl
                ?.removeSuffix("manifest.json")
                ?.removeSuffix("/") ?: continue

            Log.d("CatalogDebug", "📦 Add-on: ${addon.name} with ${catalogs.size} catalogs")

            for (catalog in catalogs) {
                val type = catalog.type?.lowercase() ?: continue
                val id = catalog.id?.lowercase() ?: continue
                val name = catalog.name ?: continue

                val nameClean = name.trim().lowercase()
                if (blockedNames.contains(nameClean)) {
                    Log.d("CatalogDebug", "🚫 Skipping unwanted tray: $name")
                    continue
                }

                val label = if (addon.name.equals("USA TV", ignoreCase = true)) {
                    "USA TV"
                } else {
                    "${name.replaceFirstChar { it.uppercase() }} – ${type.replaceFirstChar { it.uppercase() }}"
                }

                val fullUrl = "$baseUrl/catalog/$type/$id.json"
                Log.d("CatalogDebug", "📥 Fetching: $label → $fullUrl")

                try {
                    val rawJson = withContext(Dispatchers.IO) {
                        val request = Request.Builder().url(fullUrl).build()
                        val response = client.newCall(request).execute()
                        val body = response.body?.string() ?: ""

                        if (body.trim().startsWith("<!DOCTYPE") || body.contains("<html")) {
                            throw Exception("HTML response detected")
                        }

                        body
                    }

                    val json = JSONObject(rawJson)
                    val metas = json.optJSONArray("metas") ?: continue
                    val items = mutableListOf<MediaItem>()

                    for (i in 0 until metas.length()) {
                        val obj = metas.optJSONObject(i) ?: continue
                        val media = MediaItem(
                            name = obj.optString("name"),
                            poster = obj.optString("poster"),
                            description = obj.optString("description"),
                            streamUrl = obj.optString("id")
                        )
                        items.add(media)
                    }

                    if (items.isNotEmpty()) {
                        finalSections[label] = items
                        Log.d("CatalogDebug", "✅ Loaded $label: ${items.size} items")
                    }

                } catch (e: Exception) {
                    Log.e("CatalogFetcher", "❌ Failed: $label", e)
                }
            }
        }

        Log.d("CatalogDebug", "🧩 Final tray count: ${finalSections.size}")
        return finalSections
    }
}
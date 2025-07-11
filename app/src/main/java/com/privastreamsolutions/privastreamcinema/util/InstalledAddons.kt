package com.privastreamsolutions.privastreamcinema.util

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import com.privastreamsolutions.privastreamcinema.model.AddonCatalog
import com.privastreamsolutions.privastreamcinema.model.AddonManifest
import org.json.JSONArray
import org.json.JSONObject

object InstalledAddons {
    private val addons = mutableListOf<AddonManifest>()
    lateinit var appContext: Context

    fun all(): MutableList<AddonManifest> = addons

    fun install(manifest: AddonManifest) {
        if (!addons.any { it.addonUrl == manifest.addonUrl }) {
            manifest.installedAt = System.currentTimeMillis()
            addons.add(manifest)
            saveToPrefs(manifest)
            Log.d("InstallDebug", "Installed: ${manifest.name} with ${manifest.catalogs?.size ?: 0} catalogs")
        } else {
            Log.d("InstallDebug", "Skipped: ${manifest.name} already installed")
        }
    }

    fun remove(manifest: AddonManifest) {
        addons.remove(manifest)
        removeFromPrefs(manifest)
    }

    private fun saveToPrefs(manifest: AddonManifest) {
        val prefs = getPrefs()
        val rawSet = prefs.getStringSet("addonList", setOf())?.toMutableSet() ?: mutableSetOf()

        val catalogsArray = JSONArray().apply {
            manifest.catalogs?.forEach {
                put(JSONObject().apply {
                    put("name", it.name)
                    put("type", it.type)
                    put("id", it.id)
                })
            }
        }

        val json = JSONObject().apply {
            put("id", manifest.id)
            put("name", manifest.name)
            put("description", manifest.description)
            put("version", manifest.version)
            put("logo", manifest.logo)
            put("addonUrl", manifest.addonUrl)
            put("installedAt", manifest.installedAt)
            put("catalogs", catalogsArray)
        }

        rawSet.add(json.toString())
        prefs.edit().putStringSet("addonList", rawSet).apply()
    }

    private fun removeFromPrefs(manifest: AddonManifest) {
        val prefs = getPrefs()
        val rawSet = prefs.getStringSet("addonList", setOf())?.toMutableSet() ?: mutableSetOf()
        rawSet.removeIf { it.contains("\"addonUrl\":\"${manifest.addonUrl}\"") }
        prefs.edit().putStringSet("addonList", rawSet).apply()
    }

    fun loadFromPrefs(context: Context) {
        val prefs = context.getSharedPreferences("addons", Context.MODE_PRIVATE)
        val rawSet = prefs.getStringSet("addonList", emptySet()) ?: emptySet()
        for (json in rawSet) {
            try {
                val obj = JSONObject(json)

                val catalogs = obj.optJSONArray("catalogs")?.let { array ->
                    List(array.length()) { i ->
                        val c = array.getJSONObject(i)
                        AddonCatalog(
                            name = c.optString("name", "Unnamed"),
                            type = c.optString("type", ""),
                            id = c.optString("id", "")
                        )
                    }
                } ?: mutableListOf()

                val manifest = AddonManifest(
                    id = obj.optString("id"),
                    name = obj.optString("name"),
                    description = obj.optString("description"),
                    version = obj.optString("version"),
                    logo = obj.optString("logo"),
                    addonUrl = obj.optString("addonUrl"),
                    catalogs = catalogs,
                    installedAt = obj.optLong("installedAt", System.currentTimeMillis())
                )

                addons.add(manifest)
            } catch (e: Exception) {
                Log.e("InstallDebug", "Failed to restore addon from prefs", e)
            }
        }
    }

    private fun getPrefs(): SharedPreferences {
        return appContext.getSharedPreferences("addons", Context.MODE_PRIVATE)
    }
}
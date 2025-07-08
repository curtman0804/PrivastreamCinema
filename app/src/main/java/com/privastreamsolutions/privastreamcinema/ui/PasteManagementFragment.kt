package com.privastreamsolutions.privastreamcinema.ui

import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.util.Log
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.*
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import com.bumptech.glide.Glide
import com.privastreamsolutions.privastreamcinema.R
import com.privastreamsolutions.privastreamcinema.model.AddonCatalog
import com.privastreamsolutions.privastreamcinema.model.AddonManifest
import com.privastreamsolutions.privastreamcinema.util.InstalledAddons
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject

class PasteManagementFragment : Fragment() {

    private lateinit var pasteInput: EditText
    private lateinit var pasteButton: Button
    private lateinit var pasteStatus: TextView
    private val client = OkHttpClient()

    override fun onCreateView(
        inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?
    ): View? {
        return inflater.inflate(R.layout.fragment_paste_management, container, false)
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        pasteInput = view.findViewById(R.id.pasteInput)
        pasteButton = view.findViewById(R.id.pasteButton)
        pasteStatus = view.findViewById(R.id.pasteStatus)

        pasteInput.addTextChangedListener(object : TextWatcher {
            override fun afterTextChanged(s: Editable?) {
                pasteButton.isEnabled = !s.isNullOrBlank()
            }
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
        })

        pasteButton.setOnClickListener {
            val url = pasteInput.text.toString().trim()
            if (url.isBlank()) return@setOnClickListener
            installManifest(url)
        }

        val deepUrl = arguments?.getString("manifestUrl")
        if (!deepUrl.isNullOrBlank()) {
            pasteInput.setText(deepUrl)
            installManifest(deepUrl)
        }

        renderInstalledAddons()
    }

    private fun installManifest(url: String) {
        pasteStatus.text = "Fetching manifest…"

        lifecycleScope.launch {
            try {
                val rawJson = withContext(Dispatchers.IO) {
                    val request = Request.Builder().url(url).build()
                    val response = client.newCall(request).execute()
                    response.body()?.string() ?: throw Exception("Empty response")
                }

                val json = JSONObject(rawJson)
                val name = json.optString("name", "Untitled Addon")
                val desc = json.optString("description", null)
                val logoUrl = json.optString("logo", null)
                val version = json.optString("version", null)

                val catalogArray = json.optJSONArray("catalogs")
                val parsedCatalogs = mutableListOf<AddonCatalog>()

                if (catalogArray != null) {
                    for (i in 0 until catalogArray.length()) {
                        val obj = catalogArray.getJSONObject(i)
                        val id = obj.optString("id")
                        val type = obj.optString("type")
                        val catalogName = obj.optString("name", "Unnamed")
                        if (id.isNotBlank() && type.isNotBlank()) {
                            parsedCatalogs.add(AddonCatalog(catalogName, type, id)) // ID will be used to build URL dynamically
                        }
                    }
                }

                val manifest = AddonManifest(
                    id = url.hashCode().toString(),
                    name = name,
                    description = desc,
                    version = version,
                    logo = logoUrl,
                    catalogs = parsedCatalogs,
                    addonUrl = url
                )

                InstalledAddons.install(manifest)
                renderInstalledAddons()
                pasteStatus.text = "Installed: $name (${parsedCatalogs.size} catalogs)"
                Log.d("PasteDebug", "Catalogs parsed: ${parsedCatalogs.size}")
            } catch (e: Exception) {
                Log.e("PasteDebug", "Failed to install manifest", e)
                pasteStatus.text = "Failed to install: ${e.message}"
            }
        }
    }

    private fun renderInstalledAddons() {
        val container = view?.findViewById<LinearLayout>(R.id.addonList) ?: return
        container.removeAllViews()

        for (addon in InstalledAddons.all()) {
            val context = requireContext()
            val block = LinearLayout(context).apply {
                orientation = LinearLayout.HORIZONTAL
                setPadding(0, 12, 0, 12)
            }

            val icon = ImageView(context).apply {
                layoutParams = LinearLayout.LayoutParams(100, 100)
            }

            if (!addon.logo.isNullOrBlank()) {
                Glide.with(context).load(addon.logo).into(icon)
            } else {
                icon.setImageResource(R.drawable.ic_launcher_foreground)
            }

            val text = TextView(context).apply {
                text = "${addon.name}\n${addon.description ?: ""}"
                setTextColor(resources.getColor(android.R.color.white, null))
                textSize = 14f
                setPadding(16, 0, 0, 0)
            }

            block.addView(icon)
            block.addView(text)
            container.addView(block)
        }
    }
}
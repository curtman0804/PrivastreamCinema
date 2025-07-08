package com.privastreamsolutions.privastreamcinema

import android.net.Uri
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import androidx.fragment.app.Fragment
import com.google.android.material.bottomnavigation.BottomNavigationView
import com.privastreamsolutions.privastreamcinema.ui.HomeFragment
import com.privastreamsolutions.privastreamcinema.ui.SearchFragment
import com.privastreamsolutions.privastreamcinema.ui.PasteManagementFragment
import com.privastreamsolutions.privastreamcinema.util.InstalledAddons

class MainActivity : AppCompatActivity() {

    private lateinit var bottomNav: BottomNavigationView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        // ✅ Initialize context for persistent add-ons
        InstalledAddons.appContext = applicationContext
        InstalledAddons.loadFromPrefs(applicationContext)

        bottomNav = findViewById(R.id.bottomNav)

        bottomNav.setOnItemSelectedListener {
            val selectedFragment: Fragment = when (it.itemId) {
                R.id.nav_home -> HomeFragment()
                R.id.nav_search -> SearchFragment()
                R.id.nav_addons -> PasteManagementFragment()
                else -> HomeFragment()
            }
            supportFragmentManager.beginTransaction()
                .replace(R.id.fragmentContainer, selectedFragment)
                .commit()
            true
        }

        bottomNav.selectedItemId = R.id.nav_home

        // 🔁 Handle deep link return from config sites
        val data: Uri? = intent?.data
        if (data?.scheme == "privastream") {
            val manifestUrl = data.getQueryParameter("url")
            if (!manifestUrl.isNullOrBlank()) {
                val fragment = PasteManagementFragment().apply {
                    arguments = Bundle().apply {
                        putString("manifestUrl", manifestUrl)
                    }
                }
                supportFragmentManager.beginTransaction()
                    .replace(R.id.fragmentContainer, fragment)
                    .commit()
                bottomNav.selectedItemId = R.id.nav_addons
            }
        }
    }
}
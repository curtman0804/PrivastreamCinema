package com.privastreamsolutions.privastreamcinema

import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import androidx.fragment.app.Fragment
import com.google.android.material.bottomnavigation.BottomNavigationView
import com.privastreamsolutions.privastreamcinema.ui.HomeFragment
import com.privastreamsolutions.privastreamcinema.ui.SearchFragment
import com.privastreamsolutions.privastreamcinema.ui.PasteManagementFragment

class MainActivity : AppCompatActivity() {

    private lateinit var bottomNav: BottomNavigationView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        bottomNav = findViewById(R.id.bottomNav)

        bottomNav.setOnItemSelectedListener {
            val selectedFragment: Fragment = when (it.itemId) {
                R.id.nav_home -> HomeFragment()
                R.id.nav_search -> SearchFragment()
                R.id.nav_addons -> PasteManagementFragment()
                else -> HomeFragment()
            }
            supportFragmentManager.beginTransaction()
                .replace(R.id.fragment_container, selectedFragment)
                .commit()
            true
        }

        bottomNav.selectedItemId = R.id.nav_home
    }
}
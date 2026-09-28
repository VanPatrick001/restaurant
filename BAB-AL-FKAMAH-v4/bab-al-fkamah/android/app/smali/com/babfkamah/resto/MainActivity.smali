.class public Lcom/babfkamah/resto/MainActivity;
.super Landroid/app/Activity;
.source "MainActivity.java"

# Activite unique : un WebView qui affiche Resto Manager

.field public web:Landroid/webkit/WebView;

# Rappel du sélecteur de fichiers (photos du menu, photo de profil, logo)
.field public fichiers:Landroid/webkit/ValueCallback;

.method public constructor <init>()V
    .registers 1
    invoke-direct {p0}, Landroid/app/Activity;-><init>()V
    return-void
.end method

.method protected onCreate(Landroid/os/Bundle;)V
    .registers 7

    invoke-super {p0, p1}, Landroid/app/Activity;->onCreate(Landroid/os/Bundle;)V

    new-instance v0, Landroid/webkit/WebView;
    invoke-direct {v0, p0}, Landroid/webkit/WebView;-><init>(Landroid/content/Context;)V
    iput-object v0, p0, Lcom/babfkamah/resto/MainActivity;->web:Landroid/webkit/WebView;

    invoke-virtual {v0}, Landroid/webkit/WebView;->getSettings()Landroid/webkit/WebSettings;
    move-result-object v1
    const/4 v2, 0x1
    invoke-virtual {v1, v2}, Landroid/webkit/WebSettings;->setJavaScriptEnabled(Z)V
    invoke-virtual {v1, v2}, Landroid/webkit/WebSettings;->setDomStorageEnabled(Z)V
    invoke-virtual {v1, v2}, Landroid/webkit/WebSettings;->setAllowFileAccess(Z)V
    invoke-virtual {v1, v2}, Landroid/webkit/WebSettings;->setLoadWithOverviewMode(Z)V
    invoke-virtual {v1, v2}, Landroid/webkit/WebSettings;->setUseWideViewPort(Z)V
    const/4 v3, 0x0
    invoke-virtual {v1, v3}, Landroid/webkit/WebSettings;->setMediaPlaybackRequiresUserGesture(Z)V
    invoke-virtual {v1, v3}, Landroid/webkit/WebSettings;->setBuiltInZoomControls(Z)V

    # Signature de l'appli dans le User-Agent
    invoke-virtual {v1}, Landroid/webkit/WebSettings;->getUserAgentString()Ljava/lang/String;
    move-result-object v3
    new-instance v4, Ljava/lang/StringBuilder;
    invoke-direct {v4}, Ljava/lang/StringBuilder;-><init>()V
    invoke-virtual {v4, v3}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;
    const-string v3, " BabAlFkamahAndroid/4.0"
    invoke-virtual {v4, v3}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;
    invoke-virtual {v4}, Ljava/lang/StringBuilder;->toString()Ljava/lang/String;
    move-result-object v3
    invoke-virtual {v1, v3}, Landroid/webkit/WebSettings;->setUserAgentString(Ljava/lang/String;)V

    # Navigation interne + gestion des erreurs
    new-instance v1, Lcom/babfkamah/resto/Client;
    invoke-direct {v1}, Lcom/babfkamah/resto/Client;-><init>()V
    invoke-virtual {v0, v1}, Landroid/webkit/WebView;->setWebViewClient(Landroid/webkit/WebViewClient;)V

    # Sélecteur de fichiers pour <input type="file">
    new-instance v1, Lcom/babfkamah/resto/Chrome;
    invoke-direct {v1, p0}, Lcom/babfkamah/resto/Chrome;-><init>(Lcom/babfkamah/resto/MainActivity;)V
    invoke-virtual {v0, v1}, Landroid/webkit/WebView;->setWebChromeClient(Landroid/webkit/WebChromeClient;)V

    # Pont JavaScript : window.RestoAndroid.print() / .reglages()
    new-instance v1, Lcom/babfkamah/resto/Bridge;
    invoke-direct {v1, p0}, Lcom/babfkamah/resto/Bridge;-><init>(Lcom/babfkamah/resto/MainActivity;)V
    const-string v2, "RestoAndroid"
    invoke-virtual {v0, v1, v2}, Landroid/webkit/WebView;->addJavascriptInterface(Ljava/lang/Object;Ljava/lang/String;)V

    invoke-virtual {p0, v0}, Lcom/babfkamah/resto/MainActivity;->setContentView(Landroid/view/View;)V

    const-string v1, "file:///android_asset/index.html"
    invoke-virtual {v0, v1}, Landroid/webkit/WebView;->loadUrl(Ljava/lang/String;)V
    return-void
.end method

.method public onBackPressed()V
    .registers 3
    iget-object v0, p0, Lcom/babfkamah/resto/MainActivity;->web:Landroid/webkit/WebView;
    if-eqz v0, :quitter
    invoke-virtual {v0}, Landroid/webkit/WebView;->canGoBack()Z
    move-result v1
    if-eqz v1, :quitter
    invoke-virtual {v0}, Landroid/webkit/WebView;->goBack()V
    return-void
    :quitter
    invoke-super {p0}, Landroid/app/Activity;->onBackPressed()V
    return-void
.end method

.method protected onActivityResult(IILandroid/content/Intent;)V
    .registers 7
    const/16 v0, 0x2a
    if-ne p1, v0, :autre
    iget-object v1, p0, Lcom/babfkamah/resto/MainActivity;->fichiers:Landroid/webkit/ValueCallback;
    if-eqz v1, :fin
    invoke-static {p2, p3}, Landroid/webkit/WebChromeClient$FileChooserParams;->parseResult(ILandroid/content/Intent;)[Landroid/net/Uri;
    move-result-object v2
    invoke-interface {v1, v2}, Landroid/webkit/ValueCallback;->onReceiveValue(Ljava/lang/Object;)V
    const/4 v2, 0x0
    iput-object v2, p0, Lcom/babfkamah/resto/MainActivity;->fichiers:Landroid/webkit/ValueCallback;
    :fin
    return-void
    :autre
    invoke-super {p0, p1, p2, p3}, Landroid/app/Activity;->onActivityResult(IILandroid/content/Intent;)V
    return-void
.end method
